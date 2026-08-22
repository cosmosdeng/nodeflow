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
});
