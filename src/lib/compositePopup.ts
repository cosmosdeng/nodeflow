import { useGraphStore } from '../store/graphStore';
import type { FlowEdge, FlowNode } from '../types';

export const COMPOSITE_POPUP_KEY = 'nodeflow:composite:snapshot:';
export const COMPOSITE_QUERY = 'composite';

export interface CompositeSnapshot {
  label: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  savedAt: number;
}

/**
 * 读取组合节点的内部快照并写入 localStorage,然后在新窗口打开内部画布。
 * 弹窗通过 ?composite=<id> 加载,从 localStorage 读取快照后只读展示。
 */
export function openCompositePopup(id: string) {
  const st = useGraphStore.getState();
  const comp = st.nodes.find((n) => n.id === id);
  if (!comp?.data?.composite) return;
  const childSet = new Set(comp.data.composite.childIds);
  const snapshot: CompositeSnapshot = {
    label: comp.data.label || '未命名组合',
    nodes: st.nodes
      .filter((n) => childSet.has(n.id))
      .map((n) => ({ ...n, hidden: false, selected: false })),
    edges: st.edges
      .filter((e) => childSet.has(e.source) && childSet.has(e.target))
      .map((e) => ({ ...e, hidden: false, selected: false })),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(COMPOSITE_POPUP_KEY + id, JSON.stringify(snapshot));
  } catch {
    /* 快照过大或存储失败时静默 */
  }
  const url = `${location.origin}${location.pathname}?${COMPOSITE_QUERY}=${encodeURIComponent(id)}`;
  window.open(url, '_blank', 'noopener,width=1200,height=820');
}

/** 读取弹窗快照(供独立窗口使用) */
export function loadCompositeSnapshot(id: string): CompositeSnapshot | null {
  try {
    const raw = localStorage.getItem(COMPOSITE_POPUP_KEY + id);
    if (!raw) return null;
    const data = JSON.parse(raw) as CompositeSnapshot;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    return data;
  } catch {
    return null;
  }
}
