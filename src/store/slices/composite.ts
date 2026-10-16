import type {
  FlowNode,
  FlowEdge,
  GraphSnapshot,
  GraphDocument,
  ViewportState,
  Artifact,
  FlowNodeData,
  FlowEdgeData,
  Annotation,
  Stage,
  Participant,
  Organization,
  ParticipantOrderMode,
} from '../../types';
import type { FlowStore } from '../types';
import type { SliceDeps } from './deps';
import {
  buildNodesById,
  collapseComposite,
  expandComposite,
} from '../compositeHelpers';
import { closeCompositeTabInState } from '../historyHelpers';
import { computeCompositeActor, computeCompositeBounds, applyCompositeBoxes } from '../../lib/composite';
import { createDefaultNode, uid, DOCUMENT_COLORS } from '../../types';
import { findNodeById } from '../../domain/graph/queries';

export function createCompositeSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    groupSelected: () => {
      if (get().allLocked) return null;
      const s = get();
      const selectedNodes = s.nodes.filter((n) => n.selected);
      if (selectedNodes.length < 2) return null;
      get().markHistory();
      const childIds = selectedNodes.map((n) => n.id);
      const id = uid('composite');
      const bounds = computeCompositeBounds(selectedNodes, 0);
      const pos = bounds
        ? {
            x: Math.round(bounds.x + bounds.width / 2 - 170),
            y: Math.round(bounds.y + bounds.height / 2 - 120),
          }
        : { x: 100, y: 100 };
      // 组合节点执行主体继承自内部节点(全同则同、混杂则人机协同,支持嵌套),并据此推断标题
      const actor = computeCompositeActor(selectedNodes, buildNodesById(s.nodes));
      const actorLabel = actor === 'human' ? '人工' : actor === 'machine' ? '机器' : '人机协同';
      const nodes = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
      const compNode: FlowNode = {
        id,
        type: 'flow',
        position: pos,
        selected: true,
        data: {
          label: `${actorLabel}协作流程(${selectedNodes.length})`,
          description: `${selectedNodes.length} 个节点组合而成,可展开编辑内部流程`,
          actor,
          locked: false,
          inputs: [],
          outputs: [],
          composite: { expanded: false, childIds },
        },
      };
      set({ nodes: [...nodes, compNode], selected: { kind: 'node', id } });
      collapseComposite(get, set, id);
      return id;
    },
    ungroup: (id) => {
      if (get().allLocked) return;
      const node = findNodeById(get().nodes, id);
      if (!node?.data?.composite) return;
      const firstChildId = node.data.composite.childIds[0];
      // 组合节点的注释:解除编组后合并到第一个子节点
      const compAnnot = get().annotations.find(
        (a) => a.target.kind === 'node' && a.target.nodeId === id,
      );
      get().markHistory();
      expandComposite(get, set, id);
      set((s) => {
        let annotations = s.annotations;
        if (compAnnot && firstChildId) {
          const existing = s.annotations.find(
            (a) => a.target.kind === 'node' && a.target.nodeId === firstChildId,
          );
          // 先移除组合节点自身的注释
          annotations = annotations.filter((a) => a.id !== compAnnot.id);
          if (existing) {
            // 第一个子节点已有注释 → 合并内容
            const merged: Partial<Pick<Annotation, 'title' | 'content'>> = {};
            if (compAnnot.title && !existing.title) merged.title = compAnnot.title;
            const combinedContent = [existing.content, compAnnot.content].filter(Boolean).join('\n');
            if (combinedContent) merged.content = combinedContent;
            annotations = annotations.map((a) =>
              a.id === existing.id ? { ...a, ...merged } : a,
            );
          } else {
            // 第一个子节点无注释 → 把组合注释转移给它
            annotations = [
              ...annotations,
              { ...compAnnot, target: { kind: 'node', nodeId: firstChildId } },
            ];
          }
        }
        return {
          nodes: s.nodes.filter((n) => n.id !== id),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          annotations,
        };
      });
      set((s) => closeCompositeTabInState(s, id));
    },
    toggleComposite: (id) => {
      if (get().allLocked) return;
      const node = findNodeById(get().nodes, id);
      if (!node?.data?.composite) return;
      get().markHistory();
      if (node.data.composite.expanded) {
        collapseComposite(get, set, id);
      } else {
        expandComposite(get, set, id);
      }
    },
    openCompositeTab: (id) =>
      set((s) =>
        s.compositeTabs.includes(id)
          ? { activeTabId: id }
          : { compositeTabs: [...s.compositeTabs, id], activeTabId: id },
      ),
    closeCompositeTab: (id) => set((s) => closeCompositeTabInState(s, id)),
    setActiveTab: (id) => set({ activeTabId: id }),

  };
}
