# NodeFlow — 跨平台节点式流程绘图工具

一个基于 **Electron + React + React Flow** 的通用节点式流程图工具,可在 **macOS / Windows / Linux** 上运行。

## 功能特性

- **节点**:每个节点可配置多个输入 / 输出端口,包含名称与简短动作描述
- **执行主体标签**:节点可标记为 👤 人工、🤖 机器、🤝 人机协同
- **连线**:连线上可添加说明文字,以及中间产物(文档 / 图像 / 视频 / 音频 / 代码 / 数据 / 其他),中间产物带图标与文字说明
- **无限画布**:自由平移、缩放,双击画布空白处快速创建节点
- **自动保存**:所有修改防抖后自动保存到本地,刷新 / 重启不丢失
- **历史回溯**:完整撤销 / 重做 / 跳转到任意历史快照
- **大纲面板(左)**:展示全部节点,支持搜索、按执行主体分组,点击定位到画布
- **属性面板(右)**:选中节点 / 连线 / 中间产物后即可编辑其全部属性
- **导入 / 导出**:支持 JSON 文件的打开与导出

## 快速开始

```bash
# 安装依赖
bun install        # 或 npm install

# 浏览器开发模式
bun run dev        # 打开 http://localhost:5173

# 桌面应用(先构建再启动 Electron)
bun run build
bun run start

# 打包为安装程序
bun run dist:mac   # macOS (dmg/zip)
bun run dist:win   # Windows (nsis/zip)
bun run dist:linux # Linux (AppImage/deb)
```

> 若 electron 二进制下载失败,可设置镜像后重装:
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ bun install`

## 使用说明

| 操作 | 方式 |
| --- | --- |
| 创建节点 | 双击画布空白处,或工具栏「＋ 添加节点」 |
| 连线 | 从节点输出端口拖到另一节点输入端口 |
| 编辑属性 | 单击节点 / 连线 / 中间产物,在右侧「属性」面板修改 |
| 添加中间产物 | 选中连线后点击连线上的「+」,或在属性面板中添加 |
| 删除 | 选中后按 Delete / Backspace,或在属性面板中删除 |
| 撤销 / 重做 | 工具栏按钮,或 Ctrl/⌘+Z、Ctrl/⌘+Shift+Z |
| 回溯历史 | 打开「历史」面板,点击任意历史快照 |
| 保存 | 自动保存,也可 Ctrl/⌘+S 手动保存 |

## 技术栈

- [Electron](https://www.electronjs.org/) — 跨平台桌面壳
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- [React Flow](https://reactflow.dev/) — 无限画布、节点连线交互
- [Zustand](https://zustand-demo.pmnd.rs/) — 状态管理、自动保存、历史快照

## 项目结构

```
nodeflow/
├── electron/            # Electron 主进程与 preload
├── src/
│   ├── components/      # 画布、节点、连线、大纲、属性、历史等组件
│   ├── store/           # Zustand 状态(图数据 / 历史 / 自动保存)
│   ├── styles/          # 全局样式与画布主题
│   ├── types.ts         # 数据模型定义
│   ├── App.tsx          # 主界面布局
│   └── main.tsx         # 入口
└── package.json         # 依赖、脚本与 electron-builder 打包配置
```
