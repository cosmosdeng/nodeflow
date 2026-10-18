# PROGRESS — 开发进展记录

> 按日期追加。每条记录：做了什么、验证结果、遗留事项、对应提交。

---

## 2026-10-18（日）发布 v0.4.0-next.4

- **版本号**：根 `package.json` 与 `mcp-server/package.json` 统一 `0.4.0-next.3` → **`0.4.0-next.4`**（tag `v0.4.0-next.4`）
- **随版本发布的内容**：
  - 🧭 **语义面板**：参与方与阶段的定义 / 顺序 / 删除收敛为唯一入口，属性栏「管理…」双向联动
  - **工具栏重排**：文件 → 历史 → 创建 → 整理 → 显示 → 面板 → 外观与保护
  - **大纲栏**：新增按阶段 / 按参与方分组
  - **键盘移动纳入历史栈**：连续微调 500ms 内合并为一次撤销
  - **CI 护栏**：新增 lint / format:check / build
- **README**：版本历史补 `next.3`（此前缺失）与 `next.4` 两行；头部与双线对照表版本号同步；参与方入口改为「🧭 语义」面板；测试基线 441/46 → 455/48
- **验证**：`format:check` 通过、lint 0 error / 1 warn、`tsc` + electron `tsc` 干净、455 用例 / 48 文件全绿、`bun run build` 通过
- **待用户确认**：npm 发布 `@cosmosdeng/nodeflow-mcp@0.4.0-next.4` 与 GitHub Pre-release 需明确授权；`latest` dist-tag 是否继续指向 prerelease 待决策

---

## 2026-10-18（日）工具栏编组 + 语义面板分工

把「参与方 / 阶段」从「散落在三处」收敛为「一个语义入口」,并给工具栏建立稳定的分组顺序。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **工具栏编组** | 按「文件 → 历史 → 创建 → 整理 → 显示 → 面板 → 外观与保护」重排:💬 注释从创建组移入显示组(与阶段带 / 参与方带同组);面板开关集中成组并右移;🔒 锁定全部并入外观与保护组 | `src/components/Toolbar.tsx` |
| **语义面板(新)** | `SemanticPanel.tsx` 取代 `ParticipantsPanel.tsx`,成为参与方与阶段的**唯一语义入口**:组织段 + 参与方段 + 阶段段,统一支持新增 / 改名 / 拖动排序 / 删除 / 定位 | `src/components/SemanticPanel.tsx` + `src/components/SemanticOrderList.tsx` |
| **大纲栏瘦身** | 移除参与方 / 阶段顺序段,回归「节点浏览与定位」;分组下拉新增「按阶段分组」「按参与方分组」;顶部提示语义入口位置 | `src/components/OutlinePanel.tsx` |
| **双向联动** | store 新增 `semanticFocus`(runtime-only、不持久化、不进文档镜像);属性栏「参与方 / 阶段」区块标题右侧「管理…」打开语义面板并聚焦对应项;语义面板点击行 → 画布定位并选中该语义下第一个节点 | `PropertiesPanel.tsx` + `App.tsx` + `store/types.ts` + `store/slices/structure.ts` |
| **排序组件复用** | 抽出 `SemanticOrderList`(拖动排序 + 双击改名 + 单击定位 + 可选删除 + 聚焦高亮),语义面板的参与方段与阶段段共用 | `src/components/SemanticOrderList.tsx` |

### 验证

- **类型检查**:`tsc` 干净
- **Lint**:0 error / 1 warning(既有 `EditableText`)
- **单元测试**:455 用例 / 48 文件全绿
- **构建**:`bun run build` 通过
- **预览**:dev server 已启动,`http://127.0.0.1:5173/` 待人工确认

### 遗留

1. 语义面板暂不支持「参与方 / 阶段批量归属节点」(当前为单节点赋值 + 排序)
2. 大纲栏分组选择不记忆,每次打开默认「平铺显示」
3. 组件层仍为 0 测试,本轮交互改动靠人工预览验证

---

## 2026-10-17（六）代码评审后的基线加固

承接对 `PROGRESS.md` 上一阶段的自查结论，补两块「新能力没被纳入体系」的缺口。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **键盘移动纳入历史栈** | 方向键移动原直接调 `onNodesChange`，而历史快照只在 `handleNodeDragStart` 打点 → 键盘移动**无法撤销**。新增 store action `nudgeSelectedNodes(dx, dy, mergeWindowMs = 500)`：移动前 `markHistory()`，窗口内连续按键不分快照，「按住微调」一次 `Ctrl+Z` 回到移动前 | `src/store/slices/flow.ts` + `src/store/types.ts` + `src/App.tsx` + `src/store/runtimeFlags.ts` |
| **键盘微调单测** | 新增 6 用例：移动生效、`undo` 还原位置、窗口内连移只占 1 条历史、超窗口各记历史、无选中 / 演示锁定下不动且不留历史 | `src/store/__tests__/graphStore.nudge.test.ts` |
| **CI 补齐护栏** | `.github/workflows/ci.yml` 原只有 `tsc` ×2 + `vitest`，新增 `lint`（ESLint）、`format:check`（Prettier）、`build`（renderer + electron） | `.github/workflows/ci.yml` |
| **全仓格式化** | 补跑 `bun run format` —— 上一阶段改动后 22 个文件格式已漂移（正是 CI 缺 `format:check` 的后果） | 全仓 `src` / `electron` / `mcp-server/src` |

### 验证

- **单元测试**：455 用例 / 48 文件全绿（新增 6 用例）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **Lint**：0 error / 1 warning（`EditableText` 的 `set-state-in-effect`，合理用法保留）
- **Format**：`format:check` 全通过
- **构建**：`bun run build` 通过

### 遗留

1. **npm `latest` dist-tag 指向 prerelease** `0.4.0-next.3`（发布 stable `0.4.0` 时需修正，或明确 MCP 包只有 next 线）
2. **`syncActiveDoc` 与自动保存双写 documents**：每次 nodes 变化会重建 documents 两遍，订阅侧栏多一次渲染
3. **`MIRROR_FIELDS` 手工维护**：新增文档字段漏登记会静默不同步，缺镜像完整性断言
4. **组件层仍为 0 测试**：键盘连线（`L` 两步式）、DialogHost focus trap 等交互逻辑仍在组件 / `App.tsx` 内，未抽出可测单元

---

## 2026-10-17（六）路线图遗留项批量修复

### 已完成

接 `CODE_REVIEW.md` 路线图遗留项，完成 4 项：

| 项 | 内容 | 模块 |
|---|---|---|
| **friendly.ts 错误码** | `BRIDGE_UNAVAILABLE` 纳入 `AgentErrorCode` 枚举，去掉 `as unknown as AgentResponse` 断言 | `src/agent/types.ts` + `mcp-server/src/friendly.ts` |
| **ESLint + Prettier** | ESLint 9 flat config（typescript-eslint + react-hooks + prettier）；`.prettierrc` 匹配代码风格；`lint`/`format`/`format:check` 脚本；修复条件 Hook、render 期 ref 写入、`no-useless-assignment` 等 20 个 error | `eslint.config.js` + `.prettierrc` + 全仓格式化 |
| **edgePath 多障碍绕行** | 多个障碍命中时取并集包围盒统一绕行（原来只绕第一个命中） | `src/lib/edgePath.ts` |
| **layout 环处理 + 防爆栈** | 递归 DFS → Kahn 迭代 BFS；环上节点按弱连通分量同层；2000 节点深链不爆栈 | `src/lib/layout.ts` |
| **syncActiveDoc 细粒度同步** | 仅镜像字段引用变化时增量写入 documents，不再每次 set 全量重写 | `src/store/graphStore.ts` |

附带：`tsconfig` target/lib 升至 ES2022（`Error` cause 需要）；`agentBridge.ts` 错误保留 `cause` 链。

### 验证

- **单元测试**：449 用例 / 47 文件全绿（新增环层级、深链防爆栈、多障碍绕行 2 测）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **Lint**：0 error / 1 warning（`EditableText` 的 `set-state-in-effect`，合理用法保留）
- **构建**：`bun run build` 通过

### ESLint 存量 warning 清理（222 → 1）

- 批量清理冗余 import（184 个 unused specifier）：store 切片 god store 拆分遗留、类型导入
- 移除未用局部变量/函数/解构 selector（FlowCanvas 19 个、FlowNodeComponent 等）
- 修复 `exhaustive-deps`：FlowCanvas useCallback 补依赖、OutlinePanel 内联 `visibleCountOf`
- 修复无用 eslint-disable 指令
- 仅余 `EditableText` 的 `set-state-in-effect` warn（autoFocus→editing 模式切换，合理用法）

### 键盘 a11y + UI 文档同步

- **键盘移动**：方向键移动选中节点 10px，`Shift+方向键` 大步进 50px
- **键盘连线**：`L` 两步式（选源按 L → 选目标按 L），`Esc` 取消；连线模式悬浮提示
- **UI_UX_DESIGN.md 同步**：补录 §4.11 对话框（DialogHost）、EditableText ARIA、交互表新增键盘操作

### npm 发布（0.4.0-next.3）

- 发布 `@cosmosdeng/nodeflow-mcp@0.4.0-next.3`
- dist-tag 修正：`latest` → `0.4.0-next.3`，`next` → `0.4.0-next.3`
- **注意**：发布 stable `0.4.0` 时需将 `latest` 更新为 stable 版本

### 提交

| Commit | 内容 |
|---|---|
| `a18ea68` | fix(lint,algo,store): 路线图遗留项批量修复（错误码/ESLint/多障碍/环安全/增量同步） |
| `9e19258` | lint: warning 清理 222 → 1 |
| `74ac09e` | docs: PROGRESS 更新 |
| `ffdae47` | feat(a11y,docs): 键盘移动/连线 + UI_UX_DESIGN 同步 |
| `2b7b278` | docs: npm 发布记录 |

### 会话收尾

`CODE_REVIEW.md` 路线图**全部完成**：

| 路线图项 | 状态 |
|---|---|
| ~~拆 graphStore god store~~ | ✅ 早前完成 |
| ~~friendly.ts 错误码~~ | ✅ |
| ~~ESLint/Prettier~~ | ✅ |
| ~~edgePath 多障碍绕行 + layout 环处理~~ | ✅ |
| ~~syncActiveDoc 细粒度同步~~ | ✅ |
| ~~键盘连线/移动替代（a11y）~~ | ✅ |
| ~~npm latest dist-tag~~ | ✅ 发布 0.4.0-next.3 |
| ~~UI_UX_DESIGN.md 同步~~ | ✅ |

**测试基线**：449 用例 / 47 文件全绿，lint 0 error / 1 warn，`tsc` 干净，`build` 通过。

**遗留备注**：发布 stable `0.4.0` 时将 npm `latest` 更新为 stable。

### 遗留

**无**。路线图全部完成，仅备注：发布 stable `0.4.0` 时更新 npm `latest` dist-tag。

---

## 2026-10-17（二）god store 拆分

### 已完成

**拆分 `graphStore.ts`（3437 行 → 170 行 composer）**（提交 `623717d`）：

| 模块 | 行数 | 职责 |
|---|---|---|
| `store/types.ts` | 332 | FlowStore / Selection / AutoEditTarget |
| `store/persistence.ts` | 439 | 示例图、偏好、多文档 localStorage |
| `store/compositeHelpers.ts` | 434 | 塌缩/展开/隐藏刷新/端口重映射 |
| `store/historyHelpers.ts` | 107 | makeSnapshot / restoreSnapshotFields |
| `store/agentRevision.ts` | 80 | revision 指纹 |
| `store/runtimeFlags.ts` | 17 | 跨 action 运行时标志 |
| `store/slices/deps.ts` | 8 | SliceDeps 类型 |
| `store/slices/history.ts` | 73 | undo/redo/jumpTo |
| `store/slices/composite.ts` | 133 | 组合节点/标签 |
| `store/slices/edges.ts` | 270 | 端口/连线/产物 |
| `store/slices/nodes.ts` | 357 | 节点 CRUD/剪贴板/注释 |
| `store/slices/flow.ts` | 367 | RF changes/选中/主题/布局 |
| `store/slices/structure.ts` | 481 | Stage/参与方/排列/泳道 |
| `store/slices/documents.ts` | 539 | 多文档/存取/序列化 |
| `store/graphStore.ts` | **170** | composer + syncActiveDoc + 订阅 |

**对外 API 不变**：`useGraphStore` / `Selection` / `AutoEditTarget` 导出保持兼容。

### 验证

- **单元测试**：447 用例 / 47 文件全绿
- **类型检查**：`tsc` 干净
- **构建**：`bun run build` 通过
- **发布**：已推送 `origin/next`（`623717d`）

### 今日会话收尾

- 完整链路：代码评估 → P0/P1/P2 修复 → god store 拆分 → 文档 → GitHub
- **next 分支今日累计 5 个提交**已全部同步：
  - `b267fb4` fix(history,security)
  - `421f7ac` fix(test,perf)
  - `465ee38` feat(agent,ui)
  - `e66c837` docs: PROGRESS
  - `b9d2a37` docs: CODE_REVIEW
  - `623717d` refactor(store): god store 拆分
- 代理端口：本机 NinjaDesktop 当前 **7897**（历史记录为 7890）；push 用
  `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push`

### 遗留（接 `CODE_REVIEW.md` 路线图）

1. 键盘连线 / 移动替代（完整 a11y）
2. `friendly.ts` 错误码纳入 `AgentErrorCode` 枚举
3. `edgePath` 多障碍绕行；`layout` 环处理
4. ESLint/Prettier；`.mcp.json` 清理
5. npm `latest` dist-tag 指向 stable
6. `syncActiveDoc` 细粒度同步（当前整份 documents 回写）

---

## 2026-10-17

### 背景

对 `next` 分支做了一轮完整代码评估（架构 / 质量 / 安全 / 工程化），随后按 P0 → P1 → P2 修复并推送到 GitHub。

评估结论摘要：领域建模与 Agent/MCP 协议设计成熟；主要风险在 **jumpTo 快照丢字段、Agent Bridge 无鉴权、无 CI、god store**。完整评估见 [`docs/CODE_REVIEW.md`](./CODE_REVIEW.md)。

### 已完成

#### P0（阻塞级）

| 项 | 内容 | 提交 |
|---|---|---|
| jumpTo 丢数据 | 抽出 `makeSnapshot` / `restoreSnapshotFields`，`markHistory`/`undo`/`redo`/`jumpTo` 四处共用；补全 participants / organizations / participantOrder / participantOrderMode / stageOrder / arrangePending | `b267fb4` |
| Agent Bridge 安全 | 强制共享 token（`~/.nodeflow/agent-bridge.json` 0600）；Host 校验防 DNS rebinding；Origin 校验防 CSRF；`X-NodeFlow-Agent: 1` 头；`openExternal` 仅 http(s)；IPC sender 校验；requestId 冲突拒绝 | `b267fb4` |
| CI | `.github/workflows/ci.yml`：`tsc` + `tsc.electron` + `vitest`，PR/push 到 main/next 触发 | `b267fb4` |

#### P1

| 项 | 内容 | 提交 |
|---|---|---|
| edgePath 采样 bug | React Flow 输出紧凑格式 `M0 0L20 0`（命令后无空格），旧正则要求 `\s+` 导致**绕障检测完全失效**。重写 tokenizer，兼容科学计数法 | `421f7ac` |
| 测试补齐 | `edgePath` 8 测 + `exportSvg` 9 测；`jumpTo` 5 测；bridgeAuth 12 测 | `b267fb4` `421f7ac` |
| validateGraph 接入 | `loadProject` / `loadGraph` 语义校验 warn 不阻断（不再死代码） | `421f7ac` |
| 版本统一 | 根 / mcp-server / stdio / cli 全部 `0.4.0-next.3`，从 `package.json` 单一来源读取；`versionSync` 测试锁定 | `421f7ac` |
| 细粒度订阅 | 非组合节点不订 `nodes`/`edges`；注释按 id 过滤；连线障碍 `useShallow` 几何比较 | `421f7ac` |

#### P2

| 项 | 内容 | 提交 |
|---|---|---|
| assert schema 对齐 | 补 `nodeIds` / `expected` / `expectedParticipantIds` / `expectedStageIds`；`update_participant` 传 `organizationId` | `421f7ac` |
| expectedRevision | 乐观并发：mutation 带 `expectedRevision` 时 revision 不匹配返回 `REVISION_CONFLICT` 且不改状态；查询不受影响 | `465ee38` |
| 错误模型 | assert 失败统一 `isError`；失败详情不再回显完整 payload | `465ee38` |
| 死代码清理 | 删 `LEGACY_STAGE`/`LEGACY_SWIMLANE` 死 JSX、`StageComponent.tsx`、Toolbar 泳道隐藏分支；spikes 加 README（仅测试引用） | `465ee38` |
| 对话框统一 | 全局 `DialogHost` + Promise `confirm/alert`；App/Toolbar/PropertiesPanel/closeProject 共 13 处原生 `alert`/`confirm` 全部替换 | `465ee38` |
| a11y 基线 | `EditableText` 加 `role="textbox"`/`aria-*`/`tabIndex`；对话框 focus trap + 自动聚焦 | `465ee38` |

### 验证

- **单元测试**：447 用例 / 47 文件全绿（评估前约 406 / 42）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **构建**：`bun run build` 通过
- **发布**：10 个提交已推送 `origin/next`（含此前 7 个未推提交）

### 遗留 / 下一步

1. **拆 `graphStore.ts`（3430 行 god store）** —— 收益大但回归面广，建议单独 PR + 先补 store 测试
2. **键盘连线 / 移动替代**（a11y）—— 需要交互设计决策
3. **npm dist-tag**：`latest` 仍指向 prerelease `0.4.0-next.2`，发布时需 `npm dist-tag add @cosmosdeng/nodeflow-mcp@0.4.0-next.3 latest` 或改用 `@next`
4. **Agent Bridge 默认策略**：当前仍默认启动但强制 token；若需默认关闭，改 `main.ts` 的 `NODEFLOW_AGENT_BRIDGE` 判断
5. ~~**`docs/CODE_REVIEW.md`**~~：✅ 已落盘（2026-10-17）

### 环境备注

- 本机 git 代理 `127.0.0.1:7890` 当日未启动，直连推送成功；若 pull/push 失败先启动 NinjaDesktop
