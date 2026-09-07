/** NodeFlow MCP — Bridge URL 解析(默认 127.0.0.1:8787,可被 NODEFLOW_MCP_BRIDGE_URL 覆盖)。 */

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';

export function resolveBridgeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NODEFLOW_MCP_BRIDGE_URL;
  if (raw && raw.trim()) return raw.trim().replace(/\/+$/, '');
  return DEFAULT_BRIDGE_URL;
}
