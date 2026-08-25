import { describe, expect, it } from 'vitest';
import type { Artifact, FlowEdge } from '../../types';
import { hasArtifact, setEdgeArtifact, updateEdgeArtifact } from '../artifact';

function edge(id: string, artifact?: Artifact | null): FlowEdge {
  return {
    id,
    source: 'a',
    target: 'b',
    type: 'flow',
    data: { label: '', artifact: artifact ?? null },
  } as FlowEdge;
}

const art: Artifact = { id: 'a1', kind: 'document', label: '需求', description: '' };

describe('lib/artifact 中间产物领域', () => {
  it('setEdgeArtifact:设置 / 清除产物', () => {
    const e = edge('e');
    const set = setEdgeArtifact(e, art);
    expect(set.data?.artifact).toEqual(art);
    const cleared = setEdgeArtifact(set, null);
    expect(cleared.data?.artifact).toBeNull();
  });

  it('updateEdgeArtifact:仅当存在产物时更新字段', () => {
    const e = edge('e', art);
    const updated = updateEdgeArtifact(e, { label: '新标题' });
    expect(updated.data?.artifact?.label).toBe('新标题');
    expect(updated.data?.artifact?.kind).toBe('document'); // 其它字段保留
    // 无产物时不更新
    const noArt = edge('e2');
    expect(updateEdgeArtifact(noArt, { label: 'x' })).toBe(noArt);
  });

  it('hasArtifact:判断边是否挂了产物', () => {
    expect(hasArtifact(edge('e', art))).toBe(true);
    expect(hasArtifact(edge('e2'))).toBe(false);
  });
});
