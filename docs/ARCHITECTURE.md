# ARCHITECTURE.md — NodeFlow 整体架构

> 本文档描述 NodeFlow 的整体架构、技术选型、目录结构与数据流。配合 `AI_CONTEXT.md`、`NODE_SYSTEM.md`、`COMPOUND_NODE_DESIGN.md` 阅读。

## 1. 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 桌面壳 | Electron | 跨平台(Windows / macOS / Linux) |
| 渲染框架 | React 18 + TypeScript | 严格模式开发 |
| 画布引擎 | @xyflow/react (React Flow) | 节点 / 连线 / 缩放 / 小地图 |
| 状态管理 | Zustand (`src/store/graphStore.ts`) | 单一 Store,含历史与持久化 |
| 样式 | 原生 CSS (`src/styles/global.css`) | 浅色主题,深色画布背景 |
| 构建 | Vite + `vite.config.mts` | 渲染进程打包 |
| 桌面打包 | electron-builder + GitHub Actions | 三平台自动发布 |
| 包管理 | Bun / npm | `bun.lock` / `package.json` |

## 2. 分层与目录结构

```
nodeflow/
├── electron/
│   └── main.ts              # Electron 主进程:窗口创建、菜单、IPC
├── src/
│   ├── main.tsx             # 渲染进程入口(ReactFlowProvider 包裹)
│   ├── App.tsx              # 应用外壳:工具栏 + 画布 + 右侧属性面板
│   ├── types.ts             # 全部领域类型(节点/连线/端口/中间产物/组合元数据)
│   ├── store/
│   │   └── graphStore.ts    # Zustand 全局状态:节点/连线/历史/组合逻辑
│   ├── lib/
│   │   ├── composite.ts     # 组合节点纯函数:端口编码、聚合计算、边界
│   │   └── compositePopup.ts# 组合节点弹窗快照的写入/读取
│   ├── components/
│   │   ├── FlowCanvas.tsx          # 主画布(ReactFlow 封装)
│   │   ├── FlowNodeComponent.tsx   # 自定义节点组件(普通/展开/塌缩三态)
│   │   ├── FlowEdgeComponent.tsx   # 自定义连线组件(弧线 + 中间产物标签)
│   │   ├── CompositePopupView.tsx  # 独立窗口的内部画布(只读)
│   │   ├── Toolbar.tsx             # 顶部工具栏:新建/组合/锁定/历史/导入导出
│   │   ├── PropertiesPanel.tsx     # 右侧属性面板
│   │   ├── OutlinePanel.tsx        # 大纲面板(组合节点层级)
│   │   └── HistoryPanel.tsx        # 历史记录面板
│   └── styles/global.css           # 全部样式
├── docs/                           # 项目文档(AI 协作上下文)
├── electron-builder / GitHub Actions # 打包发布
└── vite.config.mts, tsconfig*.json # 构建配置
```

## 3. 进程与窗口

- **主进程** (`electron/main.ts`):创建主窗口,加载 Vite dev server 或打包产物;提供菜单;处理窗口管理。
- **渲染进程(主窗口)**:运行 React 应用,包含主画布、属性面板、大纲面板、历史面板、工具栏。
- **组合节点弹窗** (`CompositePopupView.tsx`):由主窗口通过 `window.open('?composite=<id>')` 打开独立窗口。弹窗**不共享主窗口状态**,而是通过 `lib/compositePopup.ts` 将子节点/内部连线快照写入 `localStorage`,弹窗只读渲染。此方案避免了多窗口共享 Zustand 的复杂度。

## 4. 状态与数据流

### 单一 Store 模型 (Zustand)

```
Store 状态:
├── nodes: FlowNode[]            # 全局所有节点(含组合节点的子节点)
├── edges: FlowEdge[]            # 全局所有连线
├── selected                     # 当前选中项
├── allLocked: boolean           # 演示模式:全局锁定
├── history / redoStack          # 撤销 / 重做栈
├── compositeTabs                # 内部画布标签页列表
├── activeTabId                  # 当前激活的内部画布标签
└── popupOpenIds                 # 已打开的弹窗 id 集合
```

**关键原则:单一图数据源。** 组合节点只保存 `childIds` 引用,子节点与连线仍是 `nodes / edges` 中的普通成员,由 `hidden` 字段控制是否在主画布显示。撤销 / 重做基于历史快照。

### 数据流

```
用户操作(工具栏 / 节点内联编辑 / 画布拖拽连线)
        │
        ▼
Store Actions(updateNode / addEdge / toggleComposite / ...)
        │  记录历史(history 栈) + 持久化(debounce 写入 localStorage)
        ▼
Zustand 状态更新
        │
        ▼
React 组件订阅重渲染(FlowCanvas / FlowNodeComponent / 面板)
        │
        ▼
React Flow 渲染 + CSS 样式
```

## 5. 持久化

- 自动保存:Store 变化后 **debounce** 写入 `localStorage`(`nodeflow.save.v1`)。
- 手动保存:工具栏「保存」立即写入。
- 导入 / 导出:JSON 文件(节点 + 连线 + 视图状态)。
- 弹窗快照:组合节点弹窗的内容写入 `localStorage`(`composite.snapshot.<id>`),过期由用户手动刷新重建。

## 6. 关键模块职责

| 模块 | 职责 | 备注 |
| --- | --- | --- |
| `graphStore.ts` | 全部状态与动作;组合节点的塌缩 / 展开 / 隐藏刷新;历史栈管理 | 项目核心,改动需谨慎 |
| `lib/composite.ts` | 纯函数:`encodeCompositePort` / `decodeCompositePort` / `computeCompositePorts` / `computeCompositeBounds` | 无副作用,可单测 |
| `lib/compositePopup.ts` | 弹窗快照的 save / load | localStorage 桥接 |
| `FlowNodeComponent.tsx` | 节点渲染:普通 / 展开虚线框 / 塌缩聚合端口 | 三种形态同一组件 |
| `FlowCanvas.tsx` | ReactFlow 实例、连线交互回调、内部画布 tab 渲染 | 事件集中区 |
| `Toolbar.tsx` | 全局操作入口(新建节点 / 组合 / 锁定 / 撤销重做 / 导入导出 / 清空) | |
| `PropertiesPanel.tsx` | 选中项的属性编辑(节点 / 连线 / 组合节点聚合端口只读展示) | |
| `OutlinePanel.tsx` | 节点大纲与组合层级导航 | |
| `HistoryPanel.tsx` | 撤销 / 重做历史列表 | |

## 7. 样式架构

- 全部样式集中在 `src/styles/global.css`,使用 `.nf-` 前缀避免与 React Flow 默认样式冲突。
- 节点三态样式:普通 `.nf-node`、展开组合 `.nf-composite-frame`(虚线框)、塌缩组合 `.nf-composite-node`(粗边框)。
- 深色画布背景 + 浅色节点,端口以光晕色表示连接状态(绿=已连接 / 桔=未连接)。

## 8. 构建与发布

- 开发:`bun dev` / `npm run dev`(Vite + Electron)。
- 类型检查:`tsc`(tsconfig.json 与 tsconfig.electron.json 分离)。
- 打包:electron-builder 三平台配置;GitHub Actions 在 tag 发布时自动构建并上传 Releases。
