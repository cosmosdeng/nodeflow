/**
 * NodeFlow MCP — public type surface。
 * 主使用方式是 CLI(bin nodeflow-mcp);库 API 仅暴露最小稳定集。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface AgentEnvelopeLike {
  protocolVersion: string;
  requestId: string;
  type: string;
  payload?: unknown;
}

export interface AgentResponseLike {
  protocolVersion: string;
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown } | undefined;
}

export type AgentCall = (req: AgentEnvelopeLike) => Promise<AgentResponseLike>;

export interface NodeFlowMcpServerOptions {
  callAgent: AgentCall;
  name?: string;
  version?: string;
  testFixture?: boolean;
}

export const DEFAULT_BRIDGE_URL: string;
export function resolveBridgeUrl(env?: Record<string, string | undefined>): string;
export function httpBridgeCall(baseUrl: string): AgentCall;
export function friendlyBridgeCall(baseUrl: string): AgentCall;
export function createNodeFlowMcpServer(opts: NodeFlowMcpServerOptions): McpServer;
export const toolSchemas: Record<string, unknown>;
