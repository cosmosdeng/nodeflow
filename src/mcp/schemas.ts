/**
 * NodeFlow MCP Adapter — Tool JSON Schema(zod shapes,不用 any/任意 JSON)。
 * 参数名与 Agent Interface payload 对齐,schema 是明确、可校验的。
 */
import { z } from 'zod';

const position = { x: z.number(), y: z.number() };

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
  },
  update_node: {
    nodeId: NODE_ID,
    label: z.string().optional(),
    description: z.string().optional(),
  },
  delete_node: { nodeId: NODE_ID },

  create_participant: {
    name: z.string().min(1),
    type: z
      .enum(['person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent'])
      .optional(),
  },
  update_participant: {
    id: NODE_ID,
    name: z.string().optional(),
    type: z
      .enum(['person', 'role', 'organization', 'department', 'machine', 'software', 'ai-agent'])
      .optional(),
  },
  delete_participant: { id: NODE_ID },

  create_stage: {
    name: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  update_stage: { id: NODE_ID, name: z.string().min(1).optional() },
  delete_stage: { id: NODE_ID },

  connect_edge: {
    source: NODE_ID,
    target: NODE_ID,
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
  },
  delete_edge: { id: NODE_ID },

  move_node: { nodeId: NODE_ID, ...position },
  assign_participant: { nodeId: NODE_ID, participantId: NULLABLE_STRING },
  assign_stage: { nodeId: NODE_ID, stageId: NULLABLE_STRING },
  arrange: {},
  undo: {},
  redo: {},

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
    expectedIds: z.array(z.string()).optional(),
    compositeId: z.string().nullable().optional(),
    childIds: z.array(z.string()).optional(),
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
  },
  change_gateway_type: { nodeId: NODE_ID, type: z.enum(['exclusive', 'parallel', 'inclusive']) },

  attach_artifact: {
    edgeId: NODE_ID,
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'data', 'other']),
    label: z.string().optional(),
    description: z.string().optional(),
  },
  update_artifact: {
    edgeId: NODE_ID,
    kind: z.enum(['document', 'image', 'video', 'audio', 'code', 'data', 'other']).optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  },
  remove_artifact: { edgeId: NODE_ID },

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
  },
  update_annotation: { id: NODE_ID, title: z.string().optional(), content: z.string().optional() },
  delete_annotation: { id: NODE_ID },
  move_annotation: { id: NODE_ID, x: z.number(), y: z.number() },

  // test.fixture(默认不暴露)
  reset: {},
  seed_fixture: {},
} as const;

export type ToolName = keyof typeof toolSchemas;
