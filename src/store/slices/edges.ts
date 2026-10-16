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
import {
  addNodeToStage,
  boundsToStageBox,
  computeStageBounds,
  computeStageMinSize,
} from '../../lib/stage';

import type { SliceDeps } from './deps';
import {
  refreshCompositeHidden,
  removeChildFromComposites,
} from '../compositeHelpers';
import {
  encodeCompositePort,
  decodeCompositePortPath,
  applyCompositeBoxes,
  getNodeSize,
  findParentCompositeId,
  COMPOSITE_PAD,
} from '../../lib/composite';
import { annotationTargetsEdge } from '../../lib/annotation';
import { createFlowEdge } from '../../lib/edge';
import { setEdgeArtifact, updateEdgeArtifact } from '../../lib/artifact';
import { findNodeById, findEdgeById } from '../../domain/graph/queries';
import {
  findStageEmptySpot,
  pushNodesAwayFromBox,
  pushOutOfRect,
  rectOverlaps,
  type Rect,
} from '../../lib/geometry';
import { createDefaultNode, uid } from '../../types';

export function createEdgesSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    autoGrowStage: (stageId) => {
      const s = get();
      const stage = s.stages.find((st) => st.id === stageId);
      if (!stage || !stage.nodeIds.length) return;
      const PAD = 22; // 域框内边距(节点与框边间距,遵循合理间距)
      const GAP = 14; // 外部推挤间距
      // 计算所有归属可见节点的包围盒
      const bounds = computeStageBounds(stage.nodeIds, s.nodes);
      if (!bounds) return;
      // 目标域框
      const growBox = boundsToStageBox(bounds, PAD);
      const tx = growBox.x;
      const ty = growBox.y;
      const tw = growBox.width;
      const th = growBox.height;
      // 若目标框已被当前框完全包裹,无需扩大
      if (
        tx >= stage.x &&
        ty >= stage.y &&
        tx + tw <= stage.x + stage.width &&
        ty + th <= stage.y + stage.height
      ) {
        return;
      }
      // 需要推挤的外部元素:其他可见节点(非本域归属,含组合节点)与其他阶段域框体
      const outsideNodes = s.nodes.filter((n) => !n.hidden && !stage.nodeIds.includes(n.id));
      const otherStages = s.stages.filter((st2) => st2.id !== stageId);
      const nodePos = new Map(outsideNodes.map((n) => [n.id, { ...n.position }]));
      const stagePos = new Map(otherStages.map((st) => [st.id, { x: st.x, y: st.y }]));
      const box: Rect = { x: tx, y: ty, width: tw, height: th };
      // 迭代把与扩大的域框重叠的外部元素推开(保持间距)
      const MAX = 6;
      let changed = true;
      for (let iter = 0; iter < MAX && changed; iter++) {
        changed = false;
        for (const n of outsideNodes) {
          const p = nodePos.get(n.id)!;
          const { w, h } = getNodeSize(n);
          if (rectOverlaps(p.x, p.y, w, h, box, GAP)) {
            nodePos.set(n.id, pushOutOfRect(p.x, p.y, w, h, box, GAP));
            changed = true;
          }
        }
        for (const st2 of otherStages) {
          const p = stagePos.get(st2.id)!;
          if (rectOverlaps(p.x, p.y, st2.width, st2.height, box, GAP)) {
            stagePos.set(st2.id, pushOutOfRect(p.x, p.y, st2.width, st2.height, box, GAP));
            changed = true;
          }
        }
      }
      set((st) => ({
        stages: st.stages.map((stg) => {
          if (stg.id === stageId) {
            return { ...stg, x: Math.round(tx), y: Math.round(ty), width: Math.round(tw), height: Math.round(th) };
          }
          const p = stagePos.get(stg.id);
          return p && (p.x !== stg.x || p.y !== stg.y)
            ? { ...stg, x: Math.round(p.x), y: Math.round(p.y) }
            : stg;
        }),
        nodes: st.nodes.map((n) => {
          const p = nodePos.get(n.id);
          return p && (p.x !== n.position.x || p.y !== n.position.y)
            ? { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } }
            : n;
        }),
      }));
    },

    removePort: (id, kind, portId) => {
      if (get().allLocked) return;
      const s = get();
      const node = findNodeById(s.nodes, id);
      if (!node) return;
      const list = kind === 'input' ? node.data.inputs : node.data.outputs;
      // 每个方向至少保留 1 个端口
      if (list.length <= 1) return;
      if (!list.some((p) => p.id === portId)) return;
      get().markHistory();
      const patch =
        kind === 'input'
          ? { inputs: list.filter((p) => p.id !== portId) }
          : { outputs: list.filter((p) => p.id !== portId) };
      set((s2) => ({
        nodes: s2.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        // 删除连到该端口的连线(普通端口或塌缩聚合端口的 cid: 引用)
        edges: s2.edges.filter(
          (e) =>
            !(
              e.target === id &&
              (e.targetHandle === portId ||
                e.targetHandle === encodeCompositePort(id, portId) ||
                decodeCompositePortPath(e.targetHandle)?.portId === portId)
            ) &&
            !(
              e.source === id &&
              (e.sourceHandle === portId ||
                e.sourceHandle === encodeCompositePort(id, portId) ||
                decodeCompositePortPath(e.sourceHandle)?.portId === portId)
            ),
        ),
      }));
      refreshCompositeHidden(get, set);
    },

    updateEdge: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === id
            ? {
                ...e,
                data: { ...(e.data ?? { label: '', artifact: null }), ...patch } as FlowEdgeData,
              }
            : e,
        ),
      }));
    },
    deleteEdge: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        selected: s.selected?.kind === 'edge' && s.selected.id === id ? null : s.selected,
        annotations: s.annotations.filter((a) => !annotationTargetsEdge(a, id)),
      }));
    },
    insertNodeOnEdge: (edgeId, position) => {
      if (get().allLocked) return '';
      const s = get();
      const edge = findEdgeById(s.edges, edgeId);
      if (!edge) return '';
      const src = findNodeById(s.nodes, edge.source);
      const tgt = findNodeById(s.nodes, edge.target);
      get().markHistory();
      // 默认位置:两端节点中心连线的中点
      let pos = position;
      if (!pos && src && tgt) {
        const sw = getNodeSize(src).w;
        const sh = getNodeSize(src).h;
        const tw = getNodeSize(tgt).w;
        const th = getNodeSize(tgt).h;
        pos = {
          x: Math.round((src.position.x + sw / 2 + tgt.position.x + tw / 2) / 2 - 115),
          y: Math.round((src.position.y + sh / 2 + tgt.position.y + th / 2) / 2 - 60),
        };
      }
      const node = createDefaultNode(pos ?? { x: 80, y: 80 });
      // 内部画布 → 新节点加入所属组合
      let newNode = node;
      let compId: string | null = null;
      if (s.activeTabId !== 'main') {
        compId = s.activeTabId;
        const comp = findNodeById(s.nodes, compId);
        if (comp?.data?.composite) {
          newNode = !comp.data.composite.expanded ? { ...node, hidden: true } : node;
        }
      }
      // 原连线的说明 / 产物转移到上游连线
      const { label = '', artifact = null } = edge.data ?? {};
      const upstreamId = uid('edge');
      const downstreamId = uid('edge');
      const upstream = createFlowEdge(edge.source, edge.sourceHandle, newNode.id, 'in_1', { label, artifact }, upstreamId);
      const downstream = createFlowEdge(newNode.id, 'out_1', edge.target, edge.targetHandle, undefined, downstreamId);
      set((st) => ({
        edges: st.edges.filter((e) => e.id !== edgeId).concat(upstream, downstream),
        nodes: compId
          ? st.nodes
              .map((n) =>
                n.id === compId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        composite: {
                          ...(n.data.composite as NonNullable<FlowNodeData['composite']>),
                          childIds: [...n.data.composite!.childIds, newNode.id],
                        },
                      },
                    }
                  : n,
              )
              .concat(newNode)
          : st.nodes.concat(newNode),
        // 原连线的注释(连线 / 产物归属)一并转移到上游连线
        annotations: st.annotations.map((a) =>
          annotationTargetsEdge(a, edgeId)
            ? { ...a, target: { ...a.target, edgeId: upstreamId } }
            : a,
        ),
      }));
      if (compId) refreshCompositeHidden(get, set);
      // 选中新节点并进入标题编辑
      set({
        selected: { kind: 'node', id: newNode.id },
        pendingAutoEdit: { kind: 'node-title', id: newNode.id },
      });
      return newNode.id;
    },

    setArtifact: (edgeId, artifact) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId ? setEdgeArtifact(e, artifact) : e)),
      }));
    },
    updateArtifact: (edgeId, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId ? updateEdgeArtifact(e, patch) : e)),
      }));
    },

  };
}
