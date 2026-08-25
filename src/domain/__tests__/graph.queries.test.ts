import { describe, expect, it } from 'vitest';
import type { FlowNode, FlowEdge } from '../../types';
import {
  findNodeById,
  findEdgeById,
  findNodesByIds,
  findEdgesForNode,
  isNodeReferencedByEdge,
  isEdgeDangling,
  findDuplicateIds,
} from '../graph/queries';

function node(id: string): FlowNode {
  return { id, type: 'flow', position: { x: 0, y: 0 }, data: { label: id, description: '', actor: 'machine', locked: false, inputs: [], outputs: [] } } as FlowNode;
}

function edge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target, type: 'flow', data: { label: '', artifact: null } } as FlowEdge;
}

describe('P5-02 Graph Domain 查询', () => {
  const nodes = [node('A'), node('B'), node('C')];
  const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];

  it('findNodeById / findEdgeById', () => {
    expect(findNodeById(nodes, 'B')?.id).toBe('B');
    expect(findNodeById(nodes, 'X')).toBeUndefined();
    expect(findEdgeById(edges, 'e2')?.target).toBe('C');
    expect(findEdgeById(edges, 'x')).toBeUndefined();
  });

  it('findNodesByIds 批量查找', () => {
    const result = findNodesByIds(nodes, ['A', 'C', 'GHOST']);
    expect(result.map((n) => n.id).sort()).toEqual(['A', 'C']);
  });

  it('findEdgesForNode 查找节点的所有连线', () => {
    const bEdges = findEdgesForNode(edges, 'B');
    expect(bEdges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(findEdgesForNode(edges, 'A')).toHaveLength(1);
  });

  it('isNodeReferencedByEdge', () => {
    expect(isNodeReferencedByEdge(edges, 'B')).toBe(true);
    expect(isNodeReferencedByEdge(edges, 'A')).toBe(true);
    // 单独节点未引用
    const solo = node('S');
    expect(isNodeReferencedByEdge(edges, solo.id)).toBe(false);
  });

  it('isEdgeDangling 检测悬空连线', () => {
    expect(isEdgeDangling(edges, nodes, 'e1')).toBe(false);
    // e1 的 target B 被移除后悬空
    expect(isEdgeDangling(edges, [node('A')], 'e1')).toBe(true);
    // 不存在的连线
    expect(isEdgeDangling(edges, nodes, 'ghost')).toBe(true);
  });

  it('findDuplicateIds 检测重复 id', () => {
    expect(findDuplicateIds(['a', 'b', 'a', 'c', 'b']).sort()).toEqual(['a', 'b']);
    expect(findDuplicateIds(['a', 'b', 'c'])).toHaveLength(0);
  });
});
