/**
 * Agent Interface — renderer 侧桥接。
 * 由 Electron 主进程 HTTP Bridge 通过白名单 IPC 转发 AgentRequest,
 * 本模块在 renderer 执行 Agent Core(executor)并把响应回传给主进程。
 * 浏览器/无 Electron 环境自动 no-op。
 */
import { executeAgentRequest } from './executor';
import { setAgentTestCommandsEnabled } from './capabilities';
import type { AgentRequest } from './types';

type BridgeApi = {
  onAgentBridgeRequest?: (cb: (req: AgentRequest) => void) => () => void;
  sendAgentBridgeResponse?: (resp: unknown) => void;
  onAgentBridgeCapabilities?: (cb: (caps: { testCmdsEnabled: boolean }) => void) => () => void;
};

let attached = false;

export function ensureAgentBridgeListening(): void {
  if (attached) return;
  const api = (window as unknown as { nodeflow?: BridgeApi }).nodeflow;
  const onRequest = api?.onAgentBridgeRequest;
  const send = api?.sendAgentBridgeResponse;
  const onCaps = api?.onAgentBridgeCapabilities;
  if (!onRequest || !send) return;
  attached = true;
  if (onCaps) {
    onCaps((caps) => setAgentTestCommandsEnabled(caps.testCmdsEnabled === true));
  }
  onRequest((req) => {
    void executeAgentRequest(req).then((resp) => send(resp));
  });
}
