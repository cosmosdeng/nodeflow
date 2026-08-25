import { describe, expect, it } from 'vitest';
import type { FlowNode, Organization, Participant } from '../../types';
import {
  detachOrganizationFromParticipants,
  detachParticipantFromNodes,
  isAssignedTo,
  organizationOf,
  resolveParticipant,
  validateParticipants,
} from '../participant';

const artist: Participant = { id: 'p1', name: 'Artist', type: 'person', organizationId: 'o1' };
const ai: Participant = { id: 'p2', name: 'AI Agent', type: 'ai-agent' };
const dept: Organization = { id: 'o1', name: 'Art Dept' };

function node(id: string, pid?: string): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x: 0, y: 0 },
    width: 100,
    height: 50,
    data: { label: id, description: '', actor: 'human', locked: false, inputs: [], outputs: [], participantId: pid },
  } as FlowNode;
}

describe('lib/participant 参与方领域', () => {
  it('validateParticipants:id 唯一、organizationId 存在', () => {
    expect(validateParticipants([artist, ai], [dept])).toEqual([]);
    // 重复 id
    const dup = validateParticipants([artist, { ...artist, id: 'p1' }], [dept]);
    expect(dup.some((i) => i.reason === 'duplicate id')).toBe(true);
    // 组织缺失
    const missingOrg = validateParticipants([{ ...artist, organizationId: 'ghost' }], [dept]);
    expect(missingOrg.some((i) => i.field.includes('organizationId'))).toBe(true);
  });

  it('resolveParticipant:participantId 指向存在者返回,否则 undefined', () => {
    const nodes = [node('A', 'p1'), node('B', 'missing'), node('C')];
    expect(resolveParticipant(nodes, [artist, ai], 'A')).toEqual(artist);
    expect(resolveParticipant(nodes, [artist, ai], 'B')).toBeUndefined();
    expect(resolveParticipant(nodes, [artist, ai], 'C')).toBeUndefined();
  });

  it('detachParticipantFromNodes:只清空目标节点的 participantId,不删除节点', () => {
    const nodes = [node('A', 'p1'), node('B', 'p1'), node('C', 'p2')];
    const result = detachParticipantFromNodes(nodes, 'p1');
    expect(result[0].data.participantId).toBeUndefined();
    expect(result[1].data.participantId).toBeUndefined();
    expect(result[2].data.participantId).toBe('p2'); // 其它参与方不受影响
    expect(nodes.length).toBe(3); // 不删除节点
  });

  it('detachOrganizationFromParticipants:只清空组织归属,不删除参与方', () => {
    const result = detachOrganizationFromParticipants([artist, ai], 'o1');
    expect(result[0].organizationId).toBeUndefined();
    expect(result[1].organizationId).toBeUndefined();
    expect(result.length).toBe(2); // 不删除参与方
  });

  it('organizationOf:解析参与方所属组织', () => {
    expect(organizationOf(artist, [dept])?.id).toBe('o1');
    expect(organizationOf(ai, [dept])).toBeUndefined();
  });

  it('isAssignedTo:判断节点归属', () => {
    expect(isAssignedTo(node('A', 'p1'), 'p1')).toBe(true);
    expect(isAssignedTo(node('A', 'p1'), 'p2')).toBe(false);
    expect(isAssignedTo(node('B'), 'p1')).toBe(false);
  });
});
