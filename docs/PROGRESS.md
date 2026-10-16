# PROGRESS — 开发进展记录

> 按日期追加。每条记录：做了什么、验证结果、遗留事项、对应提交。

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
