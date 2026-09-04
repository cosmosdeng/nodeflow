/**
 * NodeFlow Agent Interface — Protocol & DTO types。
 *
 * 边界原则:
 * - HTTP / Agent 永远只看到本文件中的稳定 DTO / 结构化错误;
 * - Agent 不接触 Zustand internals / React state / 任意 JS;
 * - 本阶段不实现 MCP;未来 MCP/OpenAPI 等仅作为 Adapter 复用本协议。
 */

export const AGENT_PROTOCOL_VERSION = '1';

export type AgentRequestType =
  // ---- Queries / Observe ----
  | 'getDocument'
  | 'getNodes'
  | 'getEdges'
  | 'getParticipants'
  | 'getStages'
  | 'getViewport'
  | 'getSelection'
  | 'getGraphState'
  // ---- Commands / Act ----
  | 'createNode'
  | 'updateNode'
  | 'deleteNode'
  | 'createParticipant'
  | 'updateParticipant'
  | 'deleteParticipant'
  | 'createStage'
  | 'updateStage'
  | 'deleteStage'
  | 'connectNodes'
  | 'deleteEdge'
  | 'assignParticipant'
  | 'assignStage'
  | 'moveNode'
  | 'arrange'
  | 'undo'
  | 'redo'
  // ---- Test Bridge helpers(reset/seed 仅供本地测试) ----
  | 'reset'
  | 'seedFixture'
  // ---- Assertions / Verify ----
  | 'assert'
  // (注:未知字符串类型的请求由 bridge/executor 运行时校验并结构化拒绝)
  // ---- Visual / Observe ----
  | 'getCanvasScreenshot'
  | 'getWindowScreenshot';

export interface AgentRequest {
  protocolVersion: string;
  requestId: string;
  type: AgentRequestType;
  payload?: unknown;
}

export type AgentErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_TYPE'
  | 'COMMAND_FAILED'
  | 'ASSERT_NOT_PASSED'
  | 'INTERNAL';

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  details?: unknown;
}

export interface AgentResponse<T = unknown> {
  protocolVersion: string;
  requestId: string;
  success: boolean;
  data?: T;
  error?: AgentError;
}

export interface AgentCommandResult {
  previousRevision: number;
  newRevision: number;
  /** 供调用方获取新建对象 id 等附加结果(存在时提供) */
  result?: Record<string, unknown>;
}

// ---- DTO:稳定、无 React/Zustand 细节 ----

export interface AgentNodeDto {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  width: number | null;
  height: number | null;
  participantId: string | null;
  stageId: string | null;
  actor: string;
  locked: boolean;
  isComposite: boolean;
  isGateway: boolean;
}

export interface AgentEdgeDto {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string;
}

export interface AgentParticipantDto {
  id: string;
  name: string;
  type: string;
  organizationId: string | null;
}

export interface AgentStageDto {
  id: string;
  name: string;
  nodeIds: string[];
}

export interface AgentViewportDto {
  x: number;
  y: number;
  zoom: number;
}

export type AgentSelectionDto = null | { kind: 'node' | 'edge' | 'stage' | 'annotation'; id: string };

export interface AgentGraphState {
  revision: number;
  nodes: AgentNodeDto[];
  edges: AgentEdgeDto[];
  participants: AgentParticipantDto[];
  stages: AgentStageDto[];
  viewport: AgentViewportDto;
  selection: AgentSelectionDto;
  arrangePending: boolean;
  showStageBands: boolean;
  showParticipantBands: boolean;
}

// ---- Assertions ----

export type AgentAssertionType =
  | 'assertNodeExists'
  | 'assertEdgeExists'
  | 'assertParticipantAssignment'
  | 'assertStageAssignment'
  | 'assertNodeInsideParticipant'
  | 'assertNodeInsideStage'
  | 'assertNoOverlap'
  | 'assertBandVisible'
  | 'assertBandOrder'
  | 'assertNodePosition';

export interface AgentAssertionResult {
  passed: boolean;
  assertion: AgentAssertionType;
  actual: unknown;
  expected: unknown;
  message?: string;
}

// ---- Screenshot ----

export interface AgentScreenshot {
  format: 'png';
  mimeType: 'image/png';
  /** base64(不含 data: 前缀) */
  data: string;
  width: number;
  height: number;
}
