import type { FlowNode, Organization, Participant } from '../types';

// ---- 纯逻辑:Participant / Organization 领域 ----

/**
 * 校验参与方与组织的引用完整性。
 * 返回问题列表;空数组表示合法。
 * 不修改输入。
 */
export function validateParticipants(
  participants: readonly Participant[],
  organizations: readonly Organization[],
): { field: string; reason: string }[] {
  const issues: { field: string; reason: string }[] = [];
  const pids = new Set(participants.map((p) => p.id));
  const oids = new Set(organizations.map((o) => o.id));
  // participant.id 唯一
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.id)) issues.push({ field: `participants[${p.id}]`, reason: 'duplicate id' });
    seen.add(p.id);
  }
  // participant.organizationId 指向存在组织(缺失则视为无组织,不报错)
  for (const p of participants) {
    if (p.organizationId && !oids.has(p.organizationId)) {
      issues.push({ field: `participants[${p.id}].organizationId`, reason: `references missing organization ${p.organizationId}` });
    }
  }
  return issues;
}

/**
 * 解析节点归属的参与方。participantId 缺失或指向不存在者 → 返回 undefined(视为未分配)。
 */
export function resolveParticipant(nodes: readonly FlowNode[], participants: readonly Participant[], nodeId: string): Participant | undefined {
  const node = nodes.find((n) => n.id === nodeId);
  const pid = node?.data?.participantId;
  if (!pid) return undefined;
  return participants.find((p) => p.id === pid);
}

/**
 * 删除参与方:把指向它的节点 participantId 置 undefined(safe detach,不删除节点)。
 * 返回新的节点数组,不修改输入。
 */
export function detachParticipantFromNodes(nodes: readonly FlowNode[], participantId: string): FlowNode[] {
  return nodes.map((n) =>
    n.data?.participantId === participantId
      ? { ...n, data: { ...n.data, participantId: undefined } }
      : n,
  );
}

/**
 * 删除组织:把属于它的参与方 organizationId 置 undefined(safe detach,不删除参与方)。
 * 返回新的参与方数组,不修改输入。
 */
export function detachOrganizationFromParticipants(
  participants: readonly Participant[],
  organizationId: string,
): Participant[] {
  return participants.map((p) =>
    p.organizationId === organizationId ? { ...p, organizationId: undefined } : p,
  );
}

/** 获取某参与方所属的组织 */
export function organizationOf(participant: Participant, organizations: readonly Organization[]): Organization | undefined {
  if (!participant.organizationId) return undefined;
  return organizations.find((o) => o.id === participant.organizationId);
}

/** 判断一个 node 是否已分配给某个参与方 */
export function isAssignedTo(node: FlowNode, participantId: string): boolean {
  return node.data?.participantId === participantId;
}
