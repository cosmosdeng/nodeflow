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
  computeCompositePorts,
  encodeCompositePort,
  decodeCompositePort,
  decodeCompositePortPath,
  findParentCompositeId,
  isCompositePort,
  COMPOSITE_PREFIX,
  applyCompositeBoxes,
  getNodeSize,
} from '../../lib/composite';
import {
  annotationTargetMatches,
  annotationTargetsEdge,
  annotationTargetsNode,
  annotationTargetsStage,
  anyAnnotationExpanded,
  createAnnotation,
  toggleAnnotationCollapsed as toggleAnnotationCollapsedIn,
} from '../../lib/annotation';
import { createDefaultNode, uid } from '../../types';
import { findNodeById, findEdgeById } from '../../domain/graph/queries';
import {
  collectAllDescendants,
  remapHandle,
  wrapRefToOuter,
  collapseComposite,
  removeChildFromComposites,
  edgeReferencesNode,
  refreshCompositeHidden,
  expandComposite,
  buildNodesById,
} from '../compositeHelpers';
import { closeCompositeTabInState } from '../historyHelpers';

export function createNodesSlice({ set, get }: SliceDeps): Partial<FlowStore> {
  return {
    addNode: (data, position) => {
      if (get().allLocked) return '';
      get().markHistory();
      const node = createDefaultNode(position ?? { x: 80, y: 80 });
      if (data) node.data = { ...node.data, ...data };
      set((s) => ({ nodes: [...s.nodes, node] }));
      return node.id;
    },
    addNodeToComposite: (compositeId, position) => {
      if (get().allLocked) return '';
      const comp = findNodeById(get().nodes, compositeId);
      if (!comp?.data?.composite) return '';
      // 与 addNode 一致:新建节点作为一次原子历史记录
      get().markHistory();
      const node = createDefaultNode(position ?? { x: 80, y: 80 });
      // 塌缩态下新节点在主画布隐藏(内部画布渲染时强制显示)
      const collapsed = !comp.data.composite.expanded;
      const newNode: FlowNode = collapsed ? { ...node, hidden: true } : node;
      set((s) => ({
        nodes: s.nodes
          .map((n) =>
            n.id === compositeId
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
          .concat(newNode),
      }));
      // 塌缩态下同步聚合端口快照与主画布隐藏状态
      refreshCompositeHidden(get, set);
      return newNode.id;
    },
    updateNode: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      }));
    },
    setNodeDraggable: (id, draggable) => {
      // 编辑临时态,不写历史、不检查锁定(锁定态本就不可拖)
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, draggable } : n)),
      }));
    },
    deleteNode: (id) => {
      if (get().allLocked) return;
      const target = findNodeById(get().nodes, id);
      get().markHistory();
      if (target?.data?.composite) {
        // 删除组合节点:先展开恢复子节点,再删除组合节点自身
        expandComposite(get, set, id);
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          // 清理指向该节点/连线的注释
          annotations: s.annotations.filter((a) => !annotationTargetsNode(a, id)),
        }));
        set((s) => closeCompositeTabInState(s, id));
        refreshCompositeHidden(get, set);
        return;
      }
      set((s) => {
        // 删除节点会连带删除其参与的连线,这些连线上的注释也要清理
        const removedEdges = s.edges.filter((e) => edgeReferencesNode(e, id));
        const removedEdgeIds = new Set(removedEdges.map((e) => e.id));
        return {
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => !edgeReferencesNode(e, id)),
          selected: s.selected?.kind === 'node' && s.selected.id === id ? null : s.selected,
          annotations: s.annotations.filter(
            (a) =>
              !annotationTargetsNode(a, id) &&
              !(a.target.kind === 'edge' && removedEdgeIds.has(a.target.edgeId)) &&
              !(a.target.kind === 'artifact' && removedEdgeIds.has(a.target.edgeId)),
          ),
        };
      });
      // 若删除的是某组合的子节点,从组合中移除
      removeChildFromComposites(get, set, id);
      // 刷新剩余塌缩组合的聚合端口与隐藏状态
      refreshCompositeHidden(get, set);
    },
    duplicateNode: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      const src = findNodeById(get().nodes, id);
      if (!src) return;
      // 组合节点共享 childIds,不能直接复制,否则复制品会与原组合互相干扰
      if (src.data.composite) return;
      const copy: FlowNode = {
        ...src,
        id: uid('node'),
        position: { x: src.position.x + 40, y: src.position.y + 40 },
        selected: false,
        data: {
          ...src.data,
          inputs: src.data.inputs.map((p) => ({ ...p, id: uid('in') })),
          outputs: src.data.outputs.map((p) => ({ ...p, id: uid('out') })),
        },
      };
      set((s) => ({ nodes: [...s.nodes, copy] }));
    },
    copySelection: () => {
      if (get().allLocked) return 0;
      const s = get();
      // 选中来源:优先 React Flow 节点的 .selected,补充自定义 selected 指向的节点
      const selNodes = s.nodes.filter((n) => n.selected);
      const selNodeId = s.selected?.kind === 'node' ? s.selected.id : null;
      if (selNodes.length === 0 && selNodeId) {
        const n = findNodeById(s.nodes, selNodeId);
        if (n) selNodes.push(n);
      }
      const selected = selNodes;
      if (selected.length === 0) return 0;
      // 收集选中节点 + 所有组合子孙(递归)
      const ids = new Set<string>();
      for (const n of selected) {
        ids.add(n.id);
        for (const d of collectAllDescendants(s.nodes, n.id)) ids.add(d);
      }
      const subNodes = s.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => JSON.parse(JSON.stringify(n)) as FlowNode);
      const subEdges = s.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => JSON.parse(JSON.stringify(e)) as FlowEdge);
      set({ clipboard: { nodes: subNodes, edges: subEdges } });
      return subNodes.length;
    },
    pasteClipboard: (position) => {
      if (get().allLocked) return 0;
      const clip = get().clipboard;
      if (!clip || clip.nodes.length === 0) return 0;
      get().markHistory();

      // 1. 深拷贝快照(避免污染剪贴板)
      const srcNodes = JSON.parse(JSON.stringify(clip.nodes)) as FlowNode[];
      const srcEdges = JSON.parse(JSON.stringify(clip.edges)) as FlowEdge[];

      // 2. 节点 id 重映射
      const nodeMap = new Map<string, string>();
      for (const n of srcNodes) nodeMap.set(n.id, uid('node'));

      // 3. 普通节点端口 id 重映射
      const portMap = new Map<string, string>(); // `${oldNodeId}:${oldPortId}` -> newPortId
      for (const n of srcNodes) {
        if (n.data?.composite) continue;
        const newInputs = (n.data.inputs ?? []).map((p) => {
          const np = uid('in');
          portMap.set(`${n.id}:${p.id}`, np);
          return { ...p, id: np };
        });
        const newOutputs = (n.data.outputs ?? []).map((p) => {
          const np = uid('out');
          portMap.set(`${n.id}:${p.id}`, np);
          return { ...p, id: np };
        });
        n.data = { ...n.data, inputs: newInputs, outputs: newOutputs };
      }

      // 4. 组合节点 childIds 重映射 + 节点自身 id 替换
      for (const n of srcNodes) {
        const newId = nodeMap.get(n.id)!;
        if (n.data?.composite) {
          n.data.composite = {
            ...n.data.composite,
            childIds: n.data.composite.childIds.map((cid) => nodeMap.get(cid) ?? cid),
          };
        }
        n.id = newId;
        n.selected = false;
        n.hidden = false;
        n.draggable = true;
      }

      // 5. 位置偏移:让复制内容的包围盒中心对齐到粘贴点;未指定时定位到当前视口中心(保证可见)
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of srcNodes) {
        const { w, h } = getNodeSize(n);
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      let offset: { x: number; y: number };
      if (position) {
        offset = { x: position.x - cx, y: position.y - cy };
      } else if (get().activeTabId === 'main') {
        // 主画布:取当前视口中心对应的流坐标作为粘贴点
        const vp = get().viewport;
        const container = typeof document !== 'undefined'
          ? document.querySelector('.react-flow')
          : null;
        const cw = container?.clientWidth ?? 800;
        const ch = container?.clientHeight ?? 600;
        const cx_screen = cw / 2;
        const cy_screen = ch / 2;
        const fx = (cx_screen - vp.x) / vp.zoom;
        const fy = (cy_screen - vp.y) / vp.zoom;
        offset = { x: fx - cx, y: fy - cy };
      } else {
        offset = { x: 40, y: 40 };
      }
      for (const n of srcNodes) {
        n.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
      }

      // 6. 连线重映射(source/target 与 handle)
      const newEdges: FlowEdge[] = srcEdges.map((e) => ({
        ...e,
        id: uid('edge'),
        source: nodeMap.get(e.source) ?? e.source,
        target: nodeMap.get(e.target) ?? e.target,
        sourceHandle: remapHandle(e.sourceHandle, e.source, nodeMap, portMap) ?? e.sourceHandle,
        targetHandle: remapHandle(e.targetHandle, e.target, nodeMap, portMap) ?? e.targetHandle,
        hidden: false,
        selected: false,
      }));

      // 7. 插入当前活动文档
      set((st) => ({ nodes: [...st.nodes, ...srcNodes], edges: [...st.edges, ...newEdges] }));

      // 8. 重算塌缩组合聚合端口与隐藏状态
      refreshCompositeHidden(get, set);

      // 9. 选中粘贴出的节点(便于看到并继续操作)
      if (srcNodes.length) {
        const firstNewId = srcNodes[0].id;
        set({ selected: { kind: 'node', id: firstNewId } });
      }
      return srcNodes.length;
    },

    addAnnotation: (target, position) => {
      if (get().allLocked) return '';
      // 一个主体最多只能有一个注释
      const s = get();
      const already = s.annotations.some((a) =>
        annotationTargetMatches(a.target, target),
      );
      if (already) return '';
      get().markHistory();
      const id = uid('annot');
      const annot = createAnnotation(id, target, position);
      set((st) => ({
        annotations: [...st.annotations, annot],
        annotAutoEditId: id,
      }));
      return id;
    },
    updateAnnotation: (id, patch) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    deleteAnnotation: (id) => {
      if (get().allLocked) return;
      get().markHistory();
      set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }));
    },
    toggleAnnotationCollapsed: (id) => {
      set((s) => ({ annotations: toggleAnnotationCollapsedIn(s.annotations, id) }));
    },
    setAnnotationPosition: (id, position, commitHistory) => {
      // 拖拽过程不写历史,结束时(commitHistory=true)记录一次
      if (commitHistory) get().markHistory();
      set((s) => ({
        annotations: s.annotations.map((a) =>
          a.id === id ? { ...a, position } : a,
        ),
      }));
    },
    toggleAllAnnotations: () => {
      const s = get();
      // 若存在任意展开的注释 → 全部收起;否则全部展开
      const nextCollapsed = anyAnnotationExpanded(s.annotations);
      set((s2) => ({
        annotations: s2.annotations.map((a) => ({ ...a, collapsed: nextCollapsed })),
      }));
      return nextCollapsed;
    },


  };
}
