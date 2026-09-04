import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nodeflow', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /**
   * 订阅"打开项目文件"事件(双击 .nodeflow 文件时由主进程推送文件内容)。
   * 返回取消订阅函数。
   */
  onOpenProjectFile: (cb: (payload: { filePath: string; content: string }) => void) => {
    const listener = (_e: unknown, payload: { filePath: string; content: string }) =>
      cb(payload);
    ipcRenderer.on('open-project-file', listener);
    return () => ipcRenderer.removeListener('open-project-file', listener);
  },

  /**
   * Agent Local Test Bridge(仅当主进程开启 NODEFLOW_AGENT_BRIDGE=1 时使用):
   * 订阅主进程 HTTP Bridge 转发进来的 AgentRequest,返回取消订阅函数。
   */
  onAgentBridgeRequest: (cb: (req: unknown) => void) => {
    const listener = (_e: unknown, req: unknown) => cb(req);
    ipcRenderer.on('agent:bridge:request', listener);
    return () => ipcRenderer.removeListener('agent:bridge:request', listener);
  },
  /** 订阅主进程下发的 Agent capability 配置(当前仅 test.fixture 开关)。 */
  onAgentBridgeCapabilities: (cb: (caps: { testCmdsEnabled: boolean }) => void) => {
    const listener = (_e: unknown, caps: { testCmdsEnabled: boolean }) => cb(caps);
    ipcRenderer.on('agent:bridge:capabilities', listener);
    return () => ipcRenderer.removeListener('agent:bridge:capabilities', listener);
  },
  /** 把 AgentResponse 回传给主进程 Agent Bridge(固定白名单 channel)。 */
  sendAgentBridgeResponse: (resp: unknown) => {
    ipcRenderer.send('agent:bridge:response', resp);
  },
  /** 请求主进程对整个窗口截图(capturePage),返回 PNG base64。 */
  agentCaptureWindow: () => ipcRenderer.invoke('agent:capture-window'),
});
