/**
 * NodeFlow MCP Adapter — Agent Bridge HTTP client(transport 层)。
 * MCP Server 只通过它向 NodeFlow Agent Bridge(127.0.0.1)发送信封。
 */
import type { AgentRequest, AgentResponse } from '../agent/types';

export type AgentCall = (req: AgentRequest) => Promise<AgentResponse>;

export function httpBridgeCall(baseUrl: string): AgentCall {
  return async (req) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/agent/v1/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NodeFlow Agent Bridge HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as AgentResponse;
  };
}
