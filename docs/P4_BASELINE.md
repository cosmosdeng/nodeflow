# P4-01 项目基线报告

> 建立时间:2026-08-25
>
> 用途:在开始任何 P4–P7 重构之前,记录 NodeFlow 当前的真实状态,作为后续修改的对照基线。
>
> 依据规范 P4-01:只做阅读、统计、建立报告,**不修改任何业务代码**。

## 1. 构建 / 测试基线

| 检查项 | 结果 |
| --- | --- |
| TypeScript(`npx tsc --noEmit -p tsconfig.json`) | ✅ 通过 |
| 单元测试(`bun run test`) | ✅ 通过(4 个测试文件,45 个用例) |
| 构建(`bun run build`) | ✅ 通过(有 chunk >500kB 警告,不影响) |

## 2. 代码规模(LOC)

### 核心源码

| 文件 | 行数 |
| --- | ---: |
| `src/store/graphStore.ts` | **2907** |
| `src/types.ts` | 264 |

### lib 目录

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `src/lib/composite.ts` | 197 | 组合端口编码 / 聚合 / 边界 |
| `src/lib/compositePopup.ts` | 53 | 组合弹窗快照 |
| `src/lib/edgePath.ts` | 296 | 连线绕障路径 |
| `src/lib/exportImage.ts` | 197 | JPG / PDF 导出 |
| `src/lib/exportSvg.ts` | 288 | SVG 导出(暂置灰) |
| `src/lib/layout.ts` | 187 | 自动布局 |
| `src/lib/closeProject.ts` | 27 | 关闭项目逻辑 |

### components 目录

| 文件 | 行数 |
| --- | ---: |
| `src/components/FlowCanvas.tsx` | 1153 |
| `src/components/FlowNodeComponent.tsx` | 814 |
| `src/components/FlowEdgeComponent.tsx` | 350 |
| `src/components/PropertiesPanel.tsx` | 702 |
| `src/components/Toolbar.tsx` | 493 |
| `src/components/HistoryPanel.tsx` | 146 |
| `src/components/OutlinePanel.tsx` | 167 |
| `src/components/StageComponent.tsx` | 117 |
| `src/components/AnnotationBox.tsx` | 147 |
| `src/components/CompositePopupView.tsx` | 111 |
| `src/components/ContextMenu.tsx` | 71 |
| `src/components/ConfirmDialog.tsx` | 67 |
| `src/components/EditableText.tsx` | 157 |
| `src/components/ActorIcon.tsx` | 35 |
| **合计** | **4530** |

## 3. 测试现状

| 测试文件 | 行数 | 覆盖范围 |
| --- | ---: | --- |
| `src/store/__tests__/graphStore.composite.test.ts` | 453 | 组合节点、连线插入节点、阶段域、自动排列、网关、端点连线 |
| `src/store/__tests__/nested-ungroup.test.ts` | 83 | 嵌套组合解除编组 |
| `src/lib/__tests__/composite.test.ts` | 218 | 组合端口纯函数 |
| `src/lib/__tests__/layout.test.ts` | 94 | 自动布局算法 |
| **合计** | **848** | 45 个用例 |

**主要测试范围**:组合端口纯函数、组合状态机、嵌套组合、连线插入节点、阶段域、自动排列、网关、端点连线。

**当前缺口(对照 P4 目标)**:
- ❌ 无 Graph Validation 检查函数
- ❌ 无 Graph invariant 测试
- ❌ 无 Serialization round-trip 测试
- ❌ 无 Undo / Redo 专项测试
- ❌ 无 Stage / Gateway / Annotation 独立 domain 测试

## 4. 关键入口定位

### 持久化(`.nodeflow` 文件)

| 入口 | 位置 |
| --- | --- |
| 序列化(保存) | `graphStore.ts:2346` `serializeProject()` |
| 反序列化(加载) | `graphStore.ts:2371` `loadProject(json)` |
| 静态 JSON 导出 | `graphStore.ts:2337` `exportJson()` |
| Electron 文件打开 | `electron/main.ts`(`open-file` 事件 + argv 收集) |
| Electron → 渲染 IPC | `preload.ts` `onOpenProjectFile`(`open-project-file` 事件) |

### Undo / Redo

| 入口 | 位置 |
| --- | --- |
| 记录历史 | `graphStore.ts:1415` `markHistory()` |
| 撤销 | `graphStore.ts:1433` `undo()` |
| 重做 | `graphStore.ts:1463` `redo()` |
| 可撤销判定 | `graphStore.ts:1523` `canUndo()` |
| 可重做判定 | `graphStore.ts:1524` `canRedo()` |

### Domain mutation 入口

| 领域 | 入口 | 位置 |
| --- | --- | --- |
| Node | `addNode()` / `updateNode()` | 1526 / 1566 |
| Edge | `onConnect` / `updateEdge` / `deleteEdge` / `insertNodeOnEdge` | 1391 / 2118 / 2132 / 2141 |
| Composite | `groupSelected()` / `ungroup()` / `toggleComposite()` | 2590 / 2628 / 2672 |
| Gateway | `createGatewayNode`(types.ts)+ `addNode` + `updateNode`(改 `data.gateway`) | types.ts + 1526 + 1566 |
| Stage | `addStage()` / `deleteStage()` / `moveStageNodes()` 等 | 1839 / 1877 |
| Annotation | `addAnnotation()` / `deleteAnnotation()` | 1775 / 1806 |

## 5. 当前架构风险点(仅记录,不处理)

> 依据规范规则 3(不"顺便优化")与"发现但不处理"原则,以下问题仅记录,不在 P4-01 修改。

1. **`graphStore.ts` 2907 行** —— 业务逻辑高度集中(Combposite / Gateway / Stage / Annotation / Persistence / History 都在一个文件)。
2. **网关无独立 domain**:Gateway 逻辑通过 `updateNode` 改 `data.gateway`,无专门 action。
3. **测试缺口**:无 Validation / Serialization / Undo-Redo / invariant 测试(P4 目标)。
4. **无 `.nodeflow` 版本字段与 migration**(P6 目标)。
5. **构建 chunk 过大警告**(>500kB),当前不影响功能。

## 6. 验收

- [x] `bun run test` 通过(45 用例)
- [x] `bun run build` 通过
- [x] 已记录 LOC / 测试范围 / 关键入口
- [x] 未修改任何业务代码
