/**
 * NodeFlow MCP — Bridge 连接失败时的“可读错误”包装。
 *
 * 当 NodeFlow 未启动 / Agent Bridge 不可达时,把底层网络异常包装成
 * 结构化 AgentResponse(success:false, code:BRIDGE_UNAVAILABLE),
 * 让 MCP tool 返回清晰错误而不是抛裸异常。
 */
import { httpBridgeCall, type AgentCall, type HttpBridgeCallOptions } from '../../src/mcp/bridge';
import type { AgentResponse } from '../../src/agent/types';

export function friendlyBridgeCall(baseUrl: string, options: HttpBridgeCallOptions = {}): AgentCall {
  const inner = httpBridgeCall(baseUrl, options);
  return async (req) => {
    try {
      return await inner(req);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // code 为本地扩展(非 AgentErrorCode 枚举),绕过时以结构化错误返回
      const errResp = {
        protocolVersion: req.protocolVersion,
        requestId: req.requestId,
        success: false as const,
        error: {
          code: 'BRIDGE_UNAVAILABLE',
          message: `NodeFlow is not running or Agent Bridge is unavailable at ${baseUrl}. Please start NodeFlow with NODEFLOW_AGENT_BRIDGE=1 and ensure the token in ~/.nodeflow/agent-bridge.json is readable.`,
          details: detail,
        },
      };
      return errResp as unknown as AgentResponse;
    }
  };
}
