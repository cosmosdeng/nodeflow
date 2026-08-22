import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const isDev = Boolean(process.env.ELECTRON_START_URL) || !app.isPackaged;

const appIcon = path.join(__dirname, '..', 'assets', 'icon.png');

// 待打开的项目文件路径(双击 .nodeflow 打开)
const pendingFiles: string[] = [];

// 单实例:双击文件(Windows/Linux)会触发 second-instance,而不是再开一个实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    collectArgvFiles(argv);
    // 聚焦已有主窗口
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      flushPendingFiles(win);
    }
  });
}

/** 从命令行参数中提取 .nodeflow 文件路径 */
function collectArgvFiles(argv: string[]): void {
  for (const a of argv) {
    if (a.endsWith('.nodeflow')) pendingFiles.push(a);
  }
}

/** 把待打开文件内容发送给渲染进程(去重) */
function flushPendingFiles(win: BrowserWindow): void {
  const seen = new Set<string>();
  while (pendingFiles.length) {
    const filePath = pendingFiles.shift()!;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      win.webContents.send('open-project-file', { filePath, content });
    } catch {
      /* 文件读取失败则忽略 */
    }
  }
}

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

  // 渲染进程就绪后,把启动时携带的项目文件发过去
  win.webContents.on('did-finish-load', () => flushPendingFiles(win));

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

// macOS:双击文件时会触发 open-file 事件(必须在 whenReady 之前注册)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (filePath.endsWith('.nodeflow')) {
    pendingFiles.push(filePath);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) flushPendingFiles(win);
  }
});

app.whenReady().then(() => {
  buildMenu();
  // 记录 IPC 处理器(供渲染进程询问是否带文件启动;当前主要靠主进程推送)
  ipcMain.on('open-project-file:ack', () => {
    /* 渲染进程已收到,无需处理 */
  });

  createWindow();

  // Windows/Linux:启动时若双击了 .nodeflow 文件,argv 里会带路径
  collectArgvFiles(process.argv);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
