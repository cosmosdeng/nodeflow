interface Window {
  /** Electron preload 暴露的桥接对象 */
  nodeflow?: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    /** 订阅主进程推送的"打开项目文件"事件,返回取消订阅函数 */
    onOpenProjectFile?: (
      cb: (payload: { filePath: string; content: string }) => void,
    ) => () => void;
    /** 订阅 Agent Bridge 转发进来的 AgentRequest,返回取消订阅函数 */
    onAgentBridgeRequest?: (cb: (req: unknown) => void) => () => void;
    /** 把 AgentResponse 回传给主进程 Agent Bridge */
    sendAgentBridgeResponse?: (resp: unknown) => void;
    /** 请求主进程对整个窗口截图(capturePage),返回 {format,mimeType,data,width,height} */
    agentCaptureWindow?: () => Promise<{
      format: 'png';
      mimeType: 'image/png';
      data: string;
      width: number;
      height: number;
    }>;
  };
}

declare module '*.png' {
  const src: string;
  export default src;
}
