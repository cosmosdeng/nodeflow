/**
 * NodeFlow MCP Adapter — Agent Bridge HTTP client(transport 层)。
 * MCP Server 只通过它向 NodeFlow Agent Bridge(127.0.0.1)发送信封。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRequest, AgentResponse } from '../agent/types';

export type AgentCall = (req: AgentRequest) => Promise<AgentResponse>;

export interface HttpBridgeCallOptions {
  /** 共享密钥;不传则从 NODEFLOW_AGENT_TOKEN 或 ~/.nodeflow/agent-bridge.json 读取 */
  token?: string;
}

export function resolveToken(explicit?: string): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  const fromEnv = process.env.NODEFLOW_AGENT_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const file = path.join(os.homedir(), '.nodeflow', 'agent-bridge.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { token?: string };
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

export function httpBridgeCall(baseUrl: string, options: HttpBridgeCallOptions = {}): AgentCall {
  return async (req) => {
    const token = resolveToken(options.token);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'X-NodeFlow-Agent': '1',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/agent/v1/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NodeFlow Agent Bridge HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as AgentResponse;
  };
}
