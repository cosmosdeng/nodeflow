import type { FlowNode, FlowEdge } from '../../types';
import type { FlowStore } from '../types';
import type { SliceDeps } from './deps';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { removeChildFromComposites, refreshCompositeHidden, expandComposite } from '../compositeHelpers';
import { applyCompositeBoxes, decodeCompositePort } from '../../lib/composite';

import { closeCompositeTabInState } from '../historyHelpers';
import { findNodeById } from '../../domain/graph/queries';
import { createFlowEdge } from '../../lib/edge';
import { computeLayout } from '../../lib/layout';
import { getNodeSize } from '../../lib/composite';
import { savePrefs } from '../persistence';
import {
  getEdgeDeleteHistoryPending,
  setEdgeDeleteHistoryPending,
  getLastNudgeAt,
  setLastNudgeAt,
} from '../runtimeFlags';

/** 键盘微调的历史合并窗口(ms):窗口内的连续移动合并为一条撤销记录 */
const NUDGE_MERGE_WINDOW_MS = 500;

export function createFlowSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    toggleLockAll: () => set((s) => ({ allLocked: !s.allLocked })),

    onNodesChange: (changes) => {
      // 全局锁定时不允许删除/移动等结构变更(仍允许选中查看)
      if (get().allLocked) {
        changes = changes.filter((c) => c.type !== 'remove');
        if (!changes.length) return;
      }
      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length) {
        // 若删除伴随连线(onEdgesChange 已记录「删除前含连线」快照),则不重复记历史,
        // 否则(仅删节点无关联边)在此记录,保证删除可撤销还原。
        if (getEdgeDeleteHistoryPending()) {
          setEdgeDeleteHistoryPending(false);
        } else {
          get().markHistory();
        }
        const removedIds = new Set(removes.map((c) => c.id));
        const removedCompositeIds = new Set<string>();
        // 删除组合节点前先展开,恢复其子节点
        for (const rid of removedIds) {
          const node = findNodeById(get().nodes, rid);
          if (node?.data?.composite) {
            removedCompositeIds.add(rid);
            expandComposite(get, set, rid);
          }
        }
        const applied = applyNodeChanges(changes, get().nodes);
        set((s) => ({
          nodes: applied,
          // 同时清理直接引用与通过 cid: 端口(塌缩聚合端口)引用被删节点的连线
          edges: s.edges.filter(
            (e) =>
              !removedIds.has(e.source) &&
              !removedIds.has(e.target) &&
              ![...removedIds].some(
                (rid) =>
                  decodeCompositePort(e.sourceHandle)?.nodeId === rid ||
                  decodeCompositePort(e.targetHandle)?.nodeId === rid,
              ),
          ),
          selected: s.selected?.kind === 'node' && removedIds.has(s.selected.id) ? null : s.selected,
          // 被删节点从阶段域的归属中移除
          stages: s.stages.map((st) =>
            st.nodeIds.some((nid) => removedIds.has(nid))
              ? { ...st, nodeIds: st.nodeIds.filter((nid) => !removedIds.has(nid)) }
              : st,
          ),
        }));
        // 若删除的是组合的子节点,从组合中移除;若删除的是组合节点,关闭其标签
        for (const rid of removedIds) {
          if (removedCompositeIds.has(rid)) {
            set((s) => closeCompositeTabInState(s, rid));
          } else {
            removeChildFromComposites(get, set, rid);
          }
        }
        // 统一刷新剩余塌缩组合的聚合端口与隐藏状态
        refreshCompositeHidden(get, set);
        return;
      }
      const applied = applyNodeChanges(changes, get().nodes);
      const needRecompute = changes.some((c) => c.type === 'position' || c.type === 'dimensions');
      set({ nodes: needRecompute ? applyCompositeBoxes(applied) : applied });
    },
    onEdgesChange: (changes) => {
      // 全局锁定时不允许删除连线(仍允许选中查看)
      if (get().allLocked) {
        changes = changes.filter((c) => c.type !== 'remove');
        if (!changes.length) return;
      }
      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length) {
        // React Flow 删除节点时先 triggerEdgeChanges 再 triggerNodeChanges。
        // 此处记录「删除前含连线」快照,并置标志,使随后的 onNodesChange 不再重复记历史,
        // 从而撤销删除时能完整还原节点与连线。
        setEdgeDeleteHistoryPending(true);
        // 若本次只删边(无伴随节点删除),下一宏任务自动清理标志,避免影响后续删除
        setTimeout(() => {
          setEdgeDeleteHistoryPending(false);
        }, 0);
        get().markHistory();
      }
      set((s) => {
        const removedIds = new Set(removes.map((c) => c.id));
        return {
          edges: applyEdgeChanges(changes, s.edges),
          // 删除连线时清理指向该连线的注释(含中间产物归属)
          annotations:
            removedIds.size > 0
              ? s.annotations.filter((a) => {
                  if (a.target.kind !== 'edge' && a.target.kind !== 'artifact') return true;
                  return !removedIds.has(a.target.edgeId);
                })
              : s.annotations,
        };
      });
    },
    onConnect: (conn) => {
      if (get().allLocked) return;
      get().markHistory();
      const edge = createFlowEdge(
        conn.source!,
        conn.sourceHandle ?? undefined,
        conn.target!,
        conn.targetHandle ?? undefined,
      );
      set((s) => ({ edges: [...s.edges, edge] }));
      // 若在塌缩组合内部画布中新增内部连线,同步隐藏状态
      refreshCompositeHidden(get, set);
      // 新连线创建后默认进入连线说明(label)编辑模式,并选中该连线以便属性面板显示
      set({ selected: { kind: 'edge', id: edge.id }, pendingAutoEdit: { kind: 'edge-label', id: edge.id } });
    },
    onViewportChange: (v) => set({ viewport: v }),

    setSelected: (sel) => set({ selected: sel }),

    nudgeSelectedNodes: (dx, dy, mergeWindowMs = NUDGE_MERGE_WINDOW_MS) => {
      // 演示锁定下不允许移动
      if (get().allLocked) return;
      const targets = get().nodes.filter((n) => n.selected);
      if (targets.length === 0) return;
      const now = Date.now();
      // 超出合并窗口(首次移动 / 停顿后再次移动)才打快照,使连续微调只占一条历史
      if (now - getLastNudgeAt() > mergeWindowMs) {
        get().markHistory();
      }
      setLastNudgeAt(now);
      get().onNodesChange(
        targets.map((n) => ({
          type: 'position' as const,
          id: n.id,
          position: { x: n.position.x + dx, y: n.position.y + dy },
        })),
      );
    },

    requestAutoEdit: (t) => set({ pendingAutoEdit: t }),

    setReassignHighlight: (h) =>
      set((s) => ({
        reassignHighlight: h === null ? null : { participant: null, stage: null, ...(s.reassignHighlight ?? {}), ...h },
      })),

    bumpAgentRevision: () => set((s) => ({ agentRevision: s.agentRevision + 1 })),

    setEdgeStyle: (style) => {
      set({ edgeStyle: style });
      savePrefs(get().edgeStyle, get().theme);
    },
    setTheme: (theme) => {
      set({ theme });
      savePrefs(get().edgeStyle, get().theme);
    },
    setLayoutDirection: (dir) => set({ layoutDirection: dir }),
    autoLayout: (dir, scope) => {
      if (get().allLocked) return;
      const s = get();
      // 确定布局范围:全画布可见节点 或 组合的直接子节点
      let targetIds: Set<string>;
      if (scope?.compositeId) {
        const comp = findNodeById(s.nodes, scope.compositeId);
        if (!comp?.data?.composite) return;
        targetIds = new Set(comp.data.composite.childIds);
      } else {
        targetIds = new Set(s.nodes.filter((n) => !n.hidden).map((n) => n.id));
      }
      const targets = s.nodes.filter((n) => targetIds.has(n.id));
      if (targets.length === 0) return;
      const layoutEdges = s.edges.filter((e) => targetIds.has(e.source) && targetIds.has(e.target));
      get().markHistory();

      // 组合内部布局:不做阶段域处理,直接排列
      if (scope?.compositeId) {
        const positions = computeLayout(targets, layoutEdges, dir);
        const withPositions = s.nodes.map((n) => {
          const pos = positions.get(n.id);
          return pos ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n;
        });
        set({ nodes: applyCompositeBoxes(withPositions) });
        return;
      }

      // === 全画布布局:集成阶段域 ===
      const STAGE_PAD = 22; // 域内边距
      // 1) 每个域:内部节点横向拓扑排列,域框收敛包裹
      const stageMeta = new Map<string, { w: number; h: number; x: number; y: number; inner: FlowNode[] }>();
      let finalNodes = s.nodes;
      for (const st of s.stages) {
        const inner = targets.filter((n) => st.nodeIds.includes(n.id));
        if (!inner.length) continue;
        const innerIds = new Set(inner.map((n) => n.id));
        const innerEdges = layoutEdges.filter((e) => innerIds.has(e.source) && innerIds.has(e.target));
        const positions = computeLayout(inner, innerEdges, dir);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const n of inner) {
          const p = positions.get(n.id) ?? { x: 0, y: 0 };
          const { w, h } = getNodeSize(n);
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x + w);
          maxY = Math.max(maxY, p.y + h);
        }
        const W = maxX - minX;
        const H = maxY - minY;
        // 平移内部节点到域内(以域当前左上角 + PAD 为起点)
        const baseX = st.x + STAGE_PAD - minX;
        const baseY = st.y + STAGE_PAD - minY;
        finalNodes = finalNodes.map((n) => {
          if (!innerIds.has(n.id)) return n;
          const p = positions.get(n.id) ?? { x: 0, y: 0 };
          return {
            ...n,
            position: { x: Math.round(p.x + baseX), y: Math.round(p.y + baseY) },
          };
        });
        stageMeta.set(st.id, { w: W + STAGE_PAD * 2, h: H + STAGE_PAD * 2, x: st.x, y: st.y, inner });
      }

      // 2) ② 单节点域框大小对齐「除自身外最大的域」(即倒数第二大的域框体)
      if (stageMeta.size >= 2) {
        for (const [sid, meta] of stageMeta) {
          if (meta.inner.length !== 1) continue;
          let target: { w: number; h: number } | null = null;
          for (const [oid, om] of stageMeta) {
            if (oid === sid) continue;
            if (!target || om.w * om.h > target.w * target.h) target = om;
          }
          if (target) stageMeta.set(sid, { ...meta, w: target.w, h: target.h });
        }
      }

      // 3) 整体布局:每个域作为一个「块」+ 游离节点,横向拓扑排列
      const inStage = new Set<string>();
      for (const [, meta] of stageMeta) for (const n of meta.inner) inStage.add(n.id);
      const freeNodes = targets.filter((n) => !inStage.has(n.id));
      // 构造块节点集合:域块(带自定义宽高)+ 游离节点
      const blockNodes: FlowNode[] = [
        ...[...stageMeta.entries()].map(([sid, meta]) => ({
          id: `STAGE:${sid}`,
          type: 'flow' as const,
          position: { x: meta.x, y: meta.y },
          width: meta.w,
          height: meta.h,
          data: {
            label: '',
            description: '',
            actor: 'machine' as const,
            locked: false,
            inputs: [] as FlowNode['data']['inputs'],
            outputs: [] as FlowNode['data']['outputs'],
          },
        })),
        ...freeNodes,
      ];
      // 块边:把域内节点映射到所属域块,游离节点保持自身
      const idToBlock = new Map<string, string>();
      for (const [sid, meta] of stageMeta) for (const n of meta.inner) idToBlock.set(n.id, `STAGE:${sid}`);
      for (const n of freeNodes) idToBlock.set(n.id, n.id);
      const blockEdges: FlowEdge[] = [];
      const seen = new Set<string>();
      for (const e of layoutEdges) {
        const bs = idToBlock.get(e.source);
        const bt = idToBlock.get(e.target);
        if (!bs || !bt || bs === bt) continue;
        const key = `${bs}|${bt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blockEdges.push({
          id: key,
          source: bs,
          sourceHandle: e.sourceHandle,
          target: bt,
          targetHandle: e.targetHandle,
          type: 'flow',
          data: { label: '', artifact: null },
        });
      }
      const blockPositions = computeLayout(blockNodes, blockEdges, dir);

      // 4) 应用整体布局位置:游离节点直接更新
      finalNodes = finalNodes.map((n) => {
        if (inStage.has(n.id)) return n;
        const pos = blockPositions.get(n.id);
        return pos ? { ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : n;
      });
      // 5) 更新域框到整体布局位置,内部节点随域平移
      let newStages = s.stages.map((st) => {
        const meta = stageMeta.get(st.id);
        if (!meta) return st;
        const pos = blockPositions.get(`STAGE:${st.id}`) ?? { x: st.x, y: st.y };
        const dx = pos.x - meta.x;
        const dy = pos.y - meta.y;
        if (dx || dy) {
          finalNodes = finalNodes.map((n) =>
            meta.inner.some((x) => x.id === n.id)
              ? {
                  ...n,
                  position: {
                    x: Math.round(n.position.x + dx),
                    y: Math.round(n.position.y + dy),
                  },
                }
              : n,
          );
        }
        return {
          ...st,
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          width: Math.round(meta.w),
          height: Math.round(meta.h),
        };
      });
      // ③ 所有阶段域中央水平对齐:垂直中心 y 统一
      const stageList = newStages.filter((st) => stageMeta.has(st.id));
      if (stageList.length) {
        const centerY = stageList[0].y + stageList[0].height / 2;
        newStages = stageList.map((st) => {
          const newY = centerY - st.height / 2;
          const dy = newY - st.y;
          if (dy) {
            finalNodes = finalNodes.map((n) =>
              stageMeta.get(st.id)!.inner.some((x) => x.id === n.id)
                ? { ...n, position: { x: n.position.x, y: Math.round(n.position.y + dy) } }
                : n,
            );
          }
          return { ...st, y: Math.round(newY) };
        });
      }
      set({ nodes: applyCompositeBoxes(finalNodes), stages: newStages });
    },
  };
}
