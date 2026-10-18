import type { Stage } from '../../types';
import { annotationTargetsStage } from '../../lib/annotation';
import type { FlowStore } from '../types';
import type { SliceDeps } from './deps';
import { addNodeToStage, computeStageMembership, computeStageMinSize, detachNodeIdsFromStages } from '../../lib/stage';
import { findStageEmptySpot } from '../../lib/geometry';
import { detachOrganizationFromParticipants, detachParticipantFromNodes } from '../../lib/participant';
import { arrangeSwimlanes, computeMatrixLayout } from '../../lib/arrange';
import { computeLayout } from '../../lib/layout';
import { uid } from '../../types';

export function createStructureSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    addStage: (x, y, width, height, name) => {
      if (get().allLocked) return '';
      get().markHistory();
      const id = uid('stage');
      const w = Math.round(width);
      const h = Math.round(height);
      // 在目标位置附近找一个不与任何可见节点 / 其他阶段域重合的空位
      const s = get();
      const empty = findStageEmptySpot(x, y, w, h, s.nodes, s.stages);
      const stage: Stage = {
        id,
        name: name ?? '未命名阶段',
        x: Math.round(empty.x),
        y: Math.round(empty.y),
        width: w,
        height: h,
        nodeIds: [],
        selected: true,
      };
      set((st) => ({ stages: [...st.stages, stage], stageOrder: [...st.stageOrder, id] }));
      return id;
    },
    updateStage: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.map((st) => (st.id === id ? { ...st, ...patch, id } : st)),
      }));
    },
    setStageNodes: (id, nodeIds) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.map((st) => (st.id === id ? { ...st, nodeIds } : st)),
      }));
    },
    deleteStage: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        stages: s.stages.filter((st) => st.id !== id),
        // 同步移除 order,不留 dangling reference
        stageOrder: s.stageOrder.filter((sid) => sid !== id),
        // 清理指向该阶段域的注释
        annotations: s.annotations.filter((a) => !annotationTargetsStage(a, id)),
      }));
    },
    selectStage: (id) => {
      set((s) => ({
        stages: s.stages.map((st) => ({ ...st, selected: st.id === id })),
      }));
    },
    detachNodeFromStages: (nodeId) => {
      set((s) => ({
        stages: s.stages.map((st) =>
          st.nodeIds.includes(nodeId) ? { ...st, nodeIds: st.nodeIds.filter((n) => n !== nodeId) } : st,
        ),
      }));
    },
    syncStageMembership: () => {
      const s = get();
      if (!s.stages.length) return;
      // 重新判定每个可见节点归属的域(完全包含判定)
      const owned = computeStageMembership(s.nodes, s.stages);
      // 重建每个域的 nodeIds:保留仍在域内的,补入新归属的
      const newStages = s.stages.map((st) => ({
        ...st,
        nodeIds: st.nodeIds.filter((nid) => owned.get(nid) === st.id),
      }));
      for (const [nid, sid] of owned) {
        const stage = newStages.find((st) => st.id === sid);
        if (stage && !stage.nodeIds.includes(nid)) stage.nodeIds.push(nid);
      }
      set({ stages: newStages });
    },
    moveStageNodes: (id, dx, dy, moveNodes, commitHistory) => {
      const s = get();
      const stage = s.stages.find((st) => st.id === id);
      if (!stage) return;
      if (commitHistory) get().markHistory();
      const rx = Math.round(dx);
      const ry = Math.round(dy);
      set((st) => ({
        stages: st.stages.map((stg) => (stg.id === id ? { ...stg, x: stg.x + rx, y: stg.y + ry } : stg)),
        nodes: moveNodes
          ? st.nodes.map((n) =>
              stage.nodeIds.includes(n.id) ? { ...n, position: { x: n.position.x + rx, y: n.position.y + ry } } : n,
            )
          : st.nodes,
      }));
    },
    resizeStage: (id, width, height, commitHistory) => {
      if (commitHistory) get().markHistory();
      const s = get();
      const stage = s.stages.find((st) => st.id === id);
      if (!stage) return;
      const PAD = 22;
      // 计算最小覆盖尺寸:缩小后仍须完全包住所有归属可见节点(含内边距),否则 clamp 回最小
      const { minW, minH } = computeStageMinSize(stage, s.nodes, PAD);
      const w = Math.max(minW, Math.round(width));
      const h = Math.max(minH, Math.round(height));
      set((s2) => ({
        stages: s2.stages.map((st) => (st.id === id ? { ...st, width: w, height: h } : st)),
      }));
    },
    enterNodeToStage: (stageId, nodeId) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({ stages: addNodeToStage(s.stages, stageId, nodeId) }));
    },
    detachNodesFromStages: (nodeIds) => {
      if (get().allLocked || nodeIds.length === 0) return;
      get().markHistory();
      set((s) => ({ stages: detachNodeIdsFromStages(s.stages, nodeIds) }));
    },
    addParticipant: (name, type, organizationId) => {
      if (get().allLocked) return '';
      const id = uid('participant');
      get().markHistory();
      set((s) => ({
        participants: [...s.participants, { id, name, type, organizationId }],
        // order 镜像保持与新参与方一致(P2 用户显式 reorder 前 order 恒等于实体集合)
        participantOrder: [...s.participantOrder, id],
      }));
      return id;
    },
    updateParticipant: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },
    deleteParticipant: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        participants: s.participants.filter((p) => p.id !== id),
        participantOrder: s.participantOrder.filter((pid) => pid !== id),
        // safe detach:指向该参与方的节点 participantId 置 undefined(不删除节点)
        nodes: detachParticipantFromNodes(s.nodes, id),
      }));
    },

    // ---- Order / Arrange Pending (P2:语义顺序管理;真实 Arrange 布局在后续阶段) ----
    reorderParticipant: (fromIndex, toIndex) => {
      if (get().allLocked) return;
      const order = get().participantOrder;
      // no-op:同位置 / 越界 / 空集合
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= order.length || toIndex >= order.length) return;
      const next = [...order];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      // 原子:一次 reorder = 一次 history(顺序 + mode 翻转 + pending 一起恢复)
      const prevKind = get().arrangePendingKind;
      get().markHistory();
      set(() => ({
        participantOrder: next,
        participantOrderMode: 'user', // 首次手动排序:Auto → User
        arrangePending: true, // Order Change ≠ Arrange,仅标记 pending
        arrangePendingKind: prevKind === 'stage' ? 'both' : 'participant',
      }));
    },
    reorderStage: (fromIndex, toIndex) => {
      if (get().allLocked) return;
      const order = get().stageOrder;
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= order.length || toIndex >= order.length) return;
      const next = [...order];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const prevKind = get().arrangePendingKind;
      get().markHistory();
      set(() => ({
        stageOrder: next,
        arrangePending: true,
        arrangePendingKind: prevKind === 'participant' ? 'both' : 'stage',
      }));
    },
    runArrange: () => {
      if (get().allLocked) return;
      // P3:no pending → no-op(不产生历史)
      if (!get().arrangePending) return;
      const s = get();
      // Unified Matrix Arrange:读取 semantic,计算 node.position 目标(world-space)
      const positions = computeMatrixLayout(
        {
          nodes: s.nodes,
          participants: s.participants,
          participantOrder: s.participantOrder,
          stages: s.stages,
          stageOrder: s.stageOrder,
        },
        { edges: s.edges },
      );
      if (positions.size === 0) {
        // 当前无可排顶层节点(如全部节点都是组合 child 或 hidden):不消费 pending,等待后续节点
        return;
      }
      let changed = false;
      const nodes = s.nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return n;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x === n.position.x && y === n.position.y) return n;
        changed = true;
        return { ...n, position: { x, y } };
      });
      if (!changed) {
        // 已处于 Arrange 目标位置:仅消费 pending(语义已完成),不产生额外历史
        set({ arrangePending: false, arrangePendingKind: undefined });
        return;
      }
      // 原子:一次 Arrange = 一次 history(position + pending 一起写)
      get().markHistory();
      set({ nodes, arrangePending: false, arrangePendingKind: undefined });
    },
    // 语义面板聚焦(runtime-only,不写历史、不持久化)
    setSemanticFocus: (focus) => set({ semanticFocus: focus }),

    toggleStageBands: () => {
      set((st) => ({ showStageBands: !st.showStageBands }));
    },
    toggleParticipantBands: () => {
      set((st) => ({ showParticipantBands: !st.showParticipantBands }));
    },
    runSmartArrange: () => {
      if (get().allLocked) return;
      const st = get();
      // 选中的组合 → 组合内部自动排列(不进入 band 模式)
      const selComp = st.nodes.find((n) => n.selected && !!n.data.composite);
      if (selComp) {
        st.autoLayout('horizontal', { compositeId: selComp.id });
        return;
      }
      const s = get();
      // 语义轴与视觉可见性分离:band visibility 是视觉偏好,不决定 geometry model。
      // 只要任一语义轴(Participant / Stage)存在 → 进入 unified matrix core。
      const hasParticipantAxis = s.participants.length > 0;
      const hasStageAxis = s.stages.length > 0;
      // 无语义轴(participants 与 stages 均不存在)→ 保留 legacy 纯拓扑横排(唯一允许的 legacy 路径)
      if (!hasParticipantAxis && !hasStageAxis) {
        const t = get();
        const compChild = new Set<string>();
        for (const n of t.nodes) {
          for (const cid of n.data?.composite?.childIds ?? []) compChild.add(cid);
        }
        const tops = t.nodes.filter((n) => !n.hidden && !compChild.has(n.id));
        if (tops.length === 0) return;
        const topSet = new Set(tops.map((n) => n.id));
        const pos = computeLayout(
          tops,
          t.edges.filter((e) => topSet.has(e.source) && topSet.has(e.target)),
          'horizontal',
        );
        if (pos.size === 0) return;
        let minX = Infinity;
        let minY = Infinity;
        for (const n of tops) {
          const p = pos.get(n.id);
          if (!p) continue;
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
        }
        const baseX = minX === Infinity ? 80 : 80 - minX;
        const baseY = minY === Infinity ? 80 : 80 - minY;
        let changed = false;
        const nodes = t.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return n;
          const x = Math.round(p.x + baseX);
          const y = Math.round(p.y + baseY);
          if (x === n.position.x && y === n.position.y) return n;
          changed = true;
          return { ...n, position: { x, y } };
        });
        if (!changed) return;
        get().markHistory();
        set({ nodes });
        return;
      }

      // 语义轴存在 → 与 runArrange 共用同一 unified matrix geometry core(computeMatrixLayout):
      //   X = Stage Order(col);Y = Participant Order(row);stageOnly → C+D Anchor;free → freePlacement。
      const input = {
        nodes: s.nodes,
        participants: s.participants,
        participantOrder: s.participantOrder,
        stages: s.stages,
        stageOrder: s.stageOrder,
      };
      const positions = computeMatrixLayout(input, { edges: s.edges });
      if (positions.size === 0) return; // 无可排节点:不消费 pending、不产生历史

      // 本轮 Arrange 落实了哪些轴的顺序变更;未落实的变更保留 pending
      const kind = s.arrangePendingKind ?? 'both'; // 旧数据无 kind≈两个轴都变更过
      let remain: 'participant' | 'stage' | 'both' | undefined;
      if (s.arrangePending) {
        if (kind === 'participant' && !hasParticipantAxis) remain = 'participant';
        else if (kind === 'stage' && !hasStageAxis) remain = 'stage';
        else if (kind === 'both') {
          if (!hasParticipantAxis && hasStageAxis) remain = 'participant';
          else if (hasParticipantAxis && !hasStageAxis) remain = 'stage';
          // 两个语义轴都参与布局 → 全部落实,remain=undefined
        }
      }

      let changed = false;
      const nodes = s.nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return n;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x === n.position.x && y === n.position.y) return n;
        changed = true;
        return { ...n, position: { x, y } };
      });
      if (!changed) {
        if (!s.arrangePending) return; // 无 pending 且位置未变:纯 no-op,不产生历史
        // 已处于目标:仅结算 pending(落实部分)
        set({
          arrangePending: remain !== undefined,
          arrangePendingKind: remain,
        });
        return;
      }
      get().markHistory();
      set({ nodes, arrangePending: remain !== undefined, arrangePendingKind: remain });
    },
    addOrganization: (name) => {
      if (get().allLocked) return '';
      const id = uid('org');
      get().markHistory();
      set((s) => ({ organizations: [...s.organizations, { id, name }] }));
      return id;
    },
    updateOrganization: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        organizations: s.organizations.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }));
    },
    deleteOrganization: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        organizations: s.organizations.filter((o) => o.id !== id),
        // safe detach:属于该组织的参与方 organizationId 置 undefined(不删除参与方)
        participants: detachOrganizationFromParticipants(s.participants, id),
      }));
    },
    assignParticipant: (nodeId, participantId) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, participantId: participantId ?? undefined } } : n,
        ),
      }));
    },
    assignNodeStage: (nodeId, stageId) => {
      if (get().allLocked) return;
      const s = get();
      if (stageId && !s.stages.some((st) => st.id === stageId)) return;
      if (!s.nodes.some((n) => n.id === nodeId)) return;
      get().markHistory();
      set((st) => ({
        stages: stageId ? addNodeToStage(st.stages, stageId, nodeId) : detachNodeIdsFromStages(st.stages, [nodeId]),
      }));
    },
    reassignNode: (nodeId, patch, opts) => {
      if (get().allLocked) return;
      const s = get();
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (patch.participantId && !s.participants.some((p) => p.id === patch.participantId)) return;
      if (patch.stageId && !s.stages.some((st) => st.id === patch.stageId)) return;
      const x = Math.round(patch.position.x);
      const y = Math.round(patch.position.y);
      // Phase C 拖拽路径:拖动开始处已记录历史(drag start),确认时跳过再记一次,
      // 使「position + semantic」同属一条 Undo/Redo。
      if (opts?.recordHistory !== false) get().markHistory();
      set((st) => {
        const nodes = st.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const data = { ...n.data };
          if (patch.participantId !== undefined) {
            data.participantId = patch.participantId ?? undefined;
          }
          return { ...n, position: { x, y }, data };
        });
        const stages =
          patch.stageId !== undefined
            ? patch.stageId
              ? addNodeToStage(st.stages, patch.stageId, nodeId)
              : detachNodeIdsFromStages(st.stages, [nodeId])
            : st.stages;
        return { nodes, stages };
      });
    },
    toggleSwimlane: () => {
      // 纯展示开关:不改变 graph / participantId / node position / stage / edge
      set((s) => ({ swimlaneEnabled: !s.swimlaneEnabled }));
    },
    setSwimlaneOrder: (order) => {
      set({ swimlaneOrder: order });
    },
    arrangeAllSwimlanes: () => {
      const s = get();
      if (s.allLocked) return;
      get().markHistory();
      // 只计算有 participant 的 node 的目标位置;未分配 node 保持原位
      const positions = arrangeSwimlanes(
        s.nodes,
        s.edges,
        s.participants,
        s.swimlaneOrder.length ? s.swimlaneOrder : s.participants.map((p) => p.id),
        s.layoutDirection,
      );
      if (positions.size === 0) return;
      set((st) => ({
        nodes: st.nodes.map((n) => {
          const p = positions.get(n.id);
          return p ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } } : n;
        }),
      }));
    },
  };
}
