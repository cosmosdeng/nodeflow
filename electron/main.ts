import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';

const isDev = Boolean(process.env.ELECTRON_START_URL) || !app.isPackaged;

const appIcon = path.join(__dirname, '..', 'assets', 'icon.png');

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    title: 'NodeFlow - 节点式流程绘图',
    icon: appIcon,
    backgroundColor: '#17181c',
    autoHideMenuBar: process.platform === 'win32' || process.platform === 'linux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 应用内弹窗(组合节点内部画布)创建独立窗体,其余外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const current = new URL(win.webContents.getURL());
      const sameOrigin = target.origin === current.origin;
      if (sameOrigin) {
        const child = new BrowserWindow({
          width: 1200,
          height: 820,
          title: 'NodeFlow - 组合节点内部画布',
          icon: appIcon,
          backgroundColor: '#17181c',
          autoHideMenuBar: process.platform === 'win32' || process.platform === 'linux',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        child.webContents.setWindowOpenHandler(({ url: inner }) => {
          shell.openExternal(inner);
          return { action: 'deny' };
        });
        if (isDev) {
          child.loadURL(url);
        } else {
          child.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
            query: Object.fromEntries(target.searchParams),
          });
        }
        return { action: 'deny' };
      }
    } catch {
      /* URL 解析失败则按外链处理 */
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      role: 'windowMenu',
      label: '窗口',
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
