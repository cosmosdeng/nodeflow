/**
 * NodeFlow MCP Adapter — Tool JSON Schema(zod shapes,不用 any/任意 JSON)。
 * 参数名与 Agent Interface payload 对齐,schema 是明确、可校验的。
 */
import { z } from 'zod';

const position = { x: z.number(), y: z.number() };
/** 乐观并发:客户端读到的 revision;不匹配则 REVISION_CONFLICT(可选) */
const expectedRevision = { expectedRevision: z.number().optional() };

export const NODE_ID = z.string().min(1);
export const NULLABLE_STRING = z.string().min(1).nullable();

export const toolSchemas = {
  get_graph_state: {},
  get_document: {},
  get_nodes: {},
  get_edges: {},
  get_participants: {},
  get_stages: {},
  get_viewport: {},
  get_selection: {},
  get_capabilities: {},
  get_annotations: {},

  create_node: {
    label: z.string().min(1),
    description: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    ...expectedRevision,
  },
  update_node: {
    nodeId: NODE_ID,
    label: z.string().optional(),
    description: z.string().optional(),
    ...expectedRevision,
  },
  delete_node: { nodeId: NODE_ID, ...expectedRevision },

  create_participant: {
    name: z.string().min(1),
    type: z.enum(['person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent']).optional(),
    organizationId: z.string().min(1).nullable().optional(),
    ...expectedRevision,
  },
  update_participant: {
    id: NODE_ID,
    name: z.string().optional(),
    type: z.enum(['person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent']).optional(),
    organizationId: z.string().min(1).nullable().optional(),
    ...expectedRevision,
  },
  delete_participant: { id: NODE_ID, ...expectedRevision },

  create_stage: {
    name: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    ...expectedRevision,
  },
  update_stage: { id: NODE_ID, name: z.string().min(1).optional(), ...expectedRevision },
  delete_stage: { id: NODE_ID, ...expectedRevision },

  connect_edge: {
    source: NODE_ID,
    target: NODE_ID,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    ...expectedRevision,
  },
  delete_edge: { id: NODE_ID, ...expectedRevision },

  move_node: { nodeId: NODE_ID, ...position, ...expectedRevision },
  assign_participant: { nodeId: NODE_ID, participantId: NULLABLE_STRING, ...expectedRevision },
  assign_stage: { nodeId: NODE_ID, stageId: NULLABLE_STRING, ...expectedRevision },
  arrange: { ...expectedRevision },
  undo: { ...expectedRevision },
  redo: { ...expectedRevision },

  assert: {
    type: z.enum([
      'assertNodeExists',
      'assertEdgeExists',
      'assertParticipantAssignment',
      'assertStageAssignment',
      'assertNodeInsideParticipant',
      'assertNodeInsideStage',
      'assertNoOverlap',
      'assertBandVisible',
      'assertBandOrder',
      'assertNodePosition',
      'assertCompositeContains',
      'assertNodeParent',
      'assertGatewayType',
      'assertEdgeArtifact',
      'assertAnnotationExists',
    ]),
    nodeId: z.string().optional(),
    edgeId: z.string().optional(),
    participantId: z.string().nullable().optional(),
    stageId: z.string().nullable().optional(),
    axis: z.enum(['participant', 'stage']).optional(),
    bandId: z.string().optional(),
    expected: z.union([z.boolean(), z.string()]).optional(),
    expectedIds: z.array(z.string()).optional(),
    expectedParticipantIds: z.array(z.string()).optional(),
    expectedStageIds: z.array(z.string()).optional(),
    nodeIds: z.array(z.string()).optional(),
    compositeId: z.string().nullable().optional(),
    childIds: z.array(z.string()).optional(),
    parentCompositeId: z.string().nullable().optional(),
    id: z.string().optional(),
    kind: z.string().optional(),
    content: z.string().optional(),
    title: z.string().optional(),
    expectedType: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    tolerance: z.number().optional(),
  },

  screenshot: { target: z.enum(['canvas', 'window']).default('canvas') },

  // ---- Phase D ----
  create_gateway: {
    type: z.enum(['exclusive', 'parallel', 'inclusive']),
    x: z.number().optional(),
    y: z.number().optional(),
    ...expectedRevision,
  },
  change_gateway_type: {
    nodeId: NODE_ID,
    type: z.enum(['exclusive', 'parallel', 'inclusive']),
    ...expectedRevision,
  },

  attach_artifact: {
    edgeId: NODE_ID,
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'data', 'other']),
    label: z.string().optional(),
    description: z.string().optional(),
    ...expectedRevision,
  },
  update_artifact: {
    edgeId: NODE_ID,
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'data', 'other']).optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    ...expectedRevision,
  },
  remove_artifact: { edgeId: NODE_ID, ...expectedRevision },

  create_annotation: {
    targetKind: z.enum(['canvas', 'node', 'edge', 'stage', 'artifact']),
    nodeId: z.string().optional(),
    edgeId: z.string().optional(),
    stageId: z.string().optional(),
    tabId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    ...expectedRevision,
  },
  update_annotation: {
    id: NODE_ID,
    title: z.string().optional(),
    content: z.string().optional(),
    ...expectedRevision,
  },
  delete_annotation: { id: NODE_ID, ...expectedRevision },
  move_annotation: { id: NODE_ID, x: z.number(), y: z.number(), ...expectedRevision },

  // test.fixture(默认不暴露)
  reset: { ...expectedRevision },
  seed_fixture: {},
} as const;

export type ToolName = keyof typeof toolSchemas;
