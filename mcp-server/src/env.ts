/** NodeFlow MCP — Bridge URL / token 解析。 */

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';

export function resolveBridgeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NODEFLOW_MCP_BRIDGE_URL;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, '');
  return DEFAULT_BRIDGE_URL;
}

/** 共享密钥:env 优先;缺省由 httpBridgeCall 从 ~/.nodeflow/agent-bridge.json 读取 */
export function resolveBridgeToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.NODEFLOW_AGENT_TOKEN ?? env.NODEFLOW_MCP_BRIDGE_TOKEN;
  return raw && raw.trim() ? raw.trim() : undefined;
}
