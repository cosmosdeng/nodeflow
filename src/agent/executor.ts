/**
 * Agent Interface — executor(renderer 侧核心分发)。
 * AgentRequest → Queries / Commands / Assertions / Screenshots。
 * 所有错误均结构化返回,不让 malformed 请求抛出到边界外。
 */
import { AGENT_PROTOCOL_VERSION, type AgentRequest, type AgentResponse, type AgentErrorCode } from './types';
import {
  getAnnotationsDto,
  getDocumentDto,
  getEdgesDto,
  getGraphStateDto,
  getNodesDto,
  getParticipantsDto,
  getSelectionDto,
  getStagesDto,
  getViewportDto,
} from './queries';
import { runCommand } from './commands';
import { runAssertion } from './assertions';
import { isAgentTestCommandsEnabled, TEST_ONLY_COMMANDS } from './capabilities';
import { captureCanvasScreenshot, captureWindowScreenshot } from './screenshots';
import { useGraphStore } from '../store/graphStore';

type QueryKey =
  | 'getDocument'
  | 'getNodes'
  | 'getEdges'
  | 'getParticipants'
  | 'getStages'
  | 'getViewport'
  | 'getSelection'
  | 'getGraphState'
  | 'getAnnotations';

const QUERIES: Record<QueryKey, () => unknown> = {
  getDocument: () => getDocumentDto(),
  getNodes: () => getNodesDto(),
  getEdges: () => getEdgesDto(),
  getParticipants: () => getParticipantsDto(),
  getStages: () => getStagesDto(),
  getViewport: () => getViewportDto(),
  getSelection: () => getSelectionDto(),
  getGraphState: () => getGraphStateDto(),
  getAnnotations: () => getAnnotationsDto(),
};

/** 查询/断言/截图不推进 revision,不参与乐观并发检查 */
const NON_MUTATING = new Set<string>([
  ...Object.keys(QUERIES),
  'assert',
  'getCanvasScreenshot',
  'getWindowScreenshot',
]);

function ok(requestId: string, data: unknown): AgentResponse {
  return { protocolVersion: AGENT_PROTOCOL_VERSION, requestId, success: true, data };
}

function fail(requestId: string, code: AgentErrorCode, message: string, details?: unknown): AgentResponse {
  return { protocolVersion: AGENT_PROTOCOL_VERSION, requestId, success: false, error: { code, message, details } };
}

export async function executeAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  if (req.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    return fail(
      req.requestId,
      'INVALID_REQUEST',
      `不支持的 protocolVersion: ${req.protocolVersion}(期望 ${AGENT_PROTOCOL_VERSION})`,
      { expected: AGENT_PROTOCOL_VERSION, actual: req.protocolVersion },
    );
  }

  // A-002:test-only commands(reset / seedFixture)需要显式能力开启
  if (TEST_ONLY_COMMANDS.has(req.type) && !isAgentTestCommandsEnabled()) {
    return fail(req.requestId, 'CAPABILITY_NOT_ENABLED', 'test-only command 未开启(NODEFLOW_AGENT_TEST_CMDS=1)', {
      command: req.type,
      capability: 'test.fixture',
    });
  }

  // 乐观并发:mutation 带 expectedRevision 时,revision 不匹配则拒绝
  if (req.expectedRevision !== undefined && !NON_MUTATING.has(req.type)) {
    if (typeof req.expectedRevision !== 'number' || !Number.isFinite(req.expectedRevision)) {
      return fail(req.requestId, 'INVALID_REQUEST', 'expectedRevision 必须是有限数字', {
        expectedRevision: req.expectedRevision,
      });
    }
    const current = useGraphStore.getState().agentRevision;
    if (current !== req.expectedRevision) {
      return fail(
        req.requestId,
        'REVISION_CONFLICT',
        `revision 冲突:期望 ${req.expectedRevision},当前 ${current};请重新读取状态后再提交`,
        { expectedRevision: req.expectedRevision, actualRevision: current },
      );
    }
  }

  try {
    if ((req.type as string) in QUERIES) {
      return ok(req.requestId, QUERIES[req.type as QueryKey]());
    }
    if (req.type === 'assert') {
      const result = runAssertion(req.payload);
      if (result.passed) {
        return ok(req.requestId, result);
      }
      return fail(req.requestId, 'ASSERT_NOT_PASSED', result.message ?? '断言未通过', { result });
    }
    if (req.type === 'getCanvasScreenshot') {
      return ok(req.requestId, await captureCanvasScreenshot());
    }
    if (req.type === 'getWindowScreenshot') {
      return ok(req.requestId, await captureWindowScreenshot());
    }
    // 其余均为 command
    const result = runCommand(req.type, req.payload);
    return ok(req.requestId, result);
  } catch (e) {
    const code: AgentErrorCode =
      e instanceof Error && (e as { code?: AgentErrorCode }).code === 'INVALID_PAYLOAD'
        ? 'INVALID_PAYLOAD'
        : 'COMMAND_FAILED';
    // 不回显完整 payload,只回显 type
    return fail(req.requestId, code, e instanceof Error ? e.message : String(e), {
      type: req.type,
    });
  }
}
