interface Window {
  /** Electron preload 暴露的桥接对象 */
  nodeflow?: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    /** 订阅主进程推送的"打开项目文件"事件,返回取消订阅函数 */
    onOpenProjectFile?: (
      cb: (payload: { filePath: string; content: string }) => void,
    ) => () => void;
  };
}

declare module '*.png' {
  const src: string;
  export default src;
}
