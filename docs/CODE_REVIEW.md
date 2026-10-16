# CODE_REVIEW.md — NodeFlow 代码评估报告

> 评估日期：2026-10-17 · 对象：`next` @ `e1a04b8`（v0.4.0-next.3）  
> 后续修复见 `docs/PROGRESS.md`。本文保留原始评估结论，并标注修复状态。

---

## 总体判断

**超出个人项目平均水准**：领域建模清晰、纯函数层测试扎实、Agent/MCP 协议设计成熟、文档意识强。主要风险不在“写得差”，而在**少数高危缺陷 + 架构单点（god store）+ 工程化缺口（无测试 CI、版本漂移）**。

> **产品完成度约 70–80%，工程完成度约 65%。安全对“默认开启的本机 Agent Bridge”而言不合格。**（安全项已于 2026-10-17 加固）

| 维度 | 评分 | 一句话 |
|---|---|---|
| 领域建模 | 8.5 | Who/Stage 正交轴、组合节点引用式编码都很漂亮 |
| 算法与布局 | 7.5 | 矩阵布局是最强模块；连线避障与环处理偏弱 |
| 状态管理 | 6 | 能用且一致，但 3430 行 god store + 快照字段四处复制 |
| UI / 交互 | 7 | 功能丰富、细节用心；性能订阅面过大、可访问性弱 |
| 安全 | 5 → **8** | Electron 基线好；本机 Bridge 已加强制 token / Host / Origin |
| 测试 | 7.5 → **8** | 纯函数层强；edgePath/jumpTo/export 盲区已补 |
| 文档 | 8 | 少见的好，但存在数字与功能描述漂移 |
| 工程化 | 6 → **7.5** | 发布流水线齐；已补 test/typecheck CI、版本统一 |

---

## 一、架构与领域（强项）

1. **分层干净**：Electron main → React 组件 → Zustand store → `src/lib/*` 纯函数域 → `types.ts`。与 `docs/ARCHITECTURE.md` 基本一致。
2. **语义轴正交**：Participant（Who）× Stage（When）建模清晰；`matrixClassification.ts` 是单一权威的 4 路分类（`assigned | rowOnly | stageOnly | free`）。
3. **组合节点用引用而非拷贝**：`childIds` + `hidden` + 可逆 `cid:` 端口链式编码（`composite.ts`）。
4. **矩阵布局是核心资产**：`arrange.ts` 的 `computeMatrixGridGeometry` / `computeMatrixLayout` 显式保证纯函数与确定性。
5. **安全删除不变量**：删除参与方只把 `participantId` 置空，绝不级联删节点（`participant.ts`）。

### 架构风险

| 风险 | 位置 | 状态 |
|---|---|---|
| **god store** | `graphStore.ts` ~3400 行 / ~183 action | 🔴 **遗留**（建议单独 PR） |
| **文档镜像 + 全量回写** | `syncActiveDoc` 每次 `set` 整份 documents 重写 | 🟡 遗留 |
| **快照字段四处复制** | `markHistory`/`undo`/`redo`/`jumpTo` | ✅ 已抽 `makeSnapshot`/`restoreSnapshotFields` |
| **类型逃生舱** | `types.ts` 上的 `[key: string]: unknown` | 🟡 遗留 |
| **校验器从未接入生产** | `graphValidation.ts` | ✅ 已接入 `loadProject`/`loadGraph`（warn） |
| **浅快照无克隆** | `markHistory` 直接存数组引用 | 🟡 遗留（靠 immutable 纪律） |

---

## 二、缺陷清单（按严重度）

### P0-1 — 历史跳转丢数据 ✅ 已修复（`b267fb4`）

`jumpTo` 快照/恢复漏掉 `participants / organizations / participantOrder / participantOrderMode / stageOrder / arrangePending`。用户在 History 面板跳转后这些字段被静默清空。

**修复**：抽出 `makeSnapshot` / `restoreSnapshotFields`，四处共用；补 5 个 jumpTo 往返测试。

### P0-2 — Agent Bridge 无鉴权、默认开启、可被 CSRF ✅ 已修复（`b267fb4`）

**修复**：
- 强制共享 token（启动生成，`~/.nodeflow/agent-bridge.json` 0600；`Authorization: Bearer` / `X-NodeFlow-Token`）
- Host 校验：仅 `127.0.0.1`/`localhost`/`[::1]` + 当前端口（阻断 DNS rebinding）
- Origin 校验：拒绝浏览器 http(s) Origin（阻断 CSRF）
- 要求 `X-NodeFlow-Agent: 1` 自定义头
- `openExternal` 仅 `http:`/`https:`
- IPC response 仅接受主窗口 `webContents`；requestId 冲突拒绝

### P0-3 — 无测试 CI ✅ 已修复（`b267fb4`）

`.github/workflows/ci.yml`：`tsc` + `tsc.electron` + `vitest`，PR/push 到 main/next 触发。

### P1 — 测试盲区 ✅ 大部分已补

| 模块 | 状态 |
|---|---|
| `edgePath` | ✅ 8 测 + **修复采样正则**（RF 紧凑格式 `M0 0` 导致绕障失效） |
| `exportSvg` | ✅ 9 测 |
| `jumpTo` | ✅ 5 测 |
| Bridge 鉴权 | ✅ 12 测 |
| `matrixTargets` / `compositePopup` / `closeProject` / `exportImage` | 🟡 仍无测试 |

### P1 — 性能订阅面 ✅ 已优化（`421f7ac`）

- 非组合节点不再订阅 `nodes`/`edges`
- 注释按节点/边 id 过滤
- 连线障碍 `useShallow` 几何比较
- 网关色精确 selector

### P2 — 算法与交互脆点 🟡 部分遗留

- `edgePath` 只绕开第一个障碍 —— 已锁定行为并有测试，完整多障碍绕行待做
- `layout.ts` 环上节点压成 level 0、递归 DFS 爆栈风险 —— 遗留
- `FlowCanvas` capture-phase 手写启发式 —— 遗留（注释较好）
- `MatrixVisualLayer` render 期间 setState —— 遗留

---

## 三、UI / 产品

**优点**：领域表达力强（执行主体三色、BPMN 网关、阶段域、参与方×阶段矩阵、注释、中间产物、嵌套组合）；防御性 UX（删除确认+撤销提示、演示锁、脏状态）；多文档标签 + `.nodeflow` 文件关联。

**问题与状态**：

| 问题 | 状态 |
|---|---|
| 文档与实现漂移（`LEGACY_*` 死 JSX 约 200 行） | ✅ 已删除（`465ee38`） |
| 两套对话框（原生 alert/confirm 混用） | ✅ 统一为 `DialogHost`（`465ee38`） |
| SVG 导出菜单显示“暂不可用”但 `exportSvg.ts` 已存在 | 🟡 遗留 |
| 历史面板只显示 “N nodes · M edges” | 🟡 遗留 |
| 可访问性弱 | 🟡 基线已做（`role="textbox"`、focus trap）；键盘连线/移动待做 |
| God component（`FlowCanvas` ~1300 行） | 🟡 遗留 |

---

## 四、Agent / MCP（设计最成熟的部分）

**强项**：
- 四层协议清晰：MCP stdio → npm 包 → HTTP Bridge → IPC 白名单 → Agent Core → store actions
- **Command/Revision 模型扎实**：`snapshot()` 返回 `{previousRevision, newRevision, result}`；GUI/Agent/undo 同源 Mutation Authority
- 能力门控正确：测试夹具工具默认不注册
- MCP 包已是可发布形态

**缺口与状态**：

| 问题 | 状态 |
|---|---|
| 无乐观并发 | ✅ `expectedRevision` + `REVISION_CONFLICT`（`465ee38`） |
| 失败详情整包回显 payload | ✅ 已去掉 payload 回显 |
| assert schema 漏参数 | ✅ 已补齐（`nodeIds`/`expected`/`expected*Ids`） |
| `update_participant` 丢 `organizationId` | ✅ 已修复 |
| assert 失败 success-shaped 语义不一致 | ✅ 统一 `isError` |
| `requestId` 冲突覆盖在途回调 | ✅ 已拒绝冲突 |
| `friendly.ts` 用 `as unknown as AgentResponse` 造枚举外错误码 | 🟡 遗留 |

---

## 五、工程化与发布

| 项 | 评估时 | 现状 |
|---|---|---|
| CI | 仅 release.yml | ✅ 已加 ci.yml（test + typecheck） |
| Lint | 无 ESLint/Prettier | 🟡 遗留 |
| 版本 | 三处不一致 | ✅ 统一 `0.4.0-next.3`，package.json 单一来源 |
| npm dist-tag | `latest` 指向 prerelease | 🟡 遗留（发布时修正） |
| README 测试数 | 过期 | ✅ 已同步 441/46 → 现 447/47 |
| README 功能表 | 误标 Agent 能力 | ✅ 已修正 |
| spikes 在生产树 | 冲突实验规则 | ✅ 加 README（仅测试引用，不进包） |
| `.mcp.json` 根目录 | 内容无关 | 🟡 遗留 |

---

## 六、优先修复路线图

### ✅ 已完成（2026-10-17）

1. ~~修 `jumpTo` 快照字段~~
2. ~~Agent Bridge 最小安全边界~~
3. ~~`bun run test` + `tsc` 放进 PR CI~~
4. ~~edgePath / jumpTo / export 测试~~
5. ~~`validateGraph` 接入 load~~
6. ~~版本单一来源 + README 同步~~
7. ~~细粒度 selector~~
8. ~~assert schema 对齐 + expectedRevision~~
9. ~~统一对话框 + 清 LEGACY 死代码 + spikes 说明~~
10. ~~a11y 基线（textbox role + focus trap）~~

### 🔴 下一步（按优先级）

1. **拆 `graphStore.ts`**：按 history / composite / documents / stages / participants / agent 切片（单独 PR + 先补 store 测试）
2. **键盘连线 / 移动替代**（完整 a11y）
3. **`friendly.ts` 错误码纳入 `AgentErrorCode` 枚举**
4. **`edgePath` 多障碍绕行**；`layout` 环处理
5. **ESLint/Prettier**；`.mcp.json` 清理
6. **npm `latest` dist-tag** 指向 stable；`docs/UI_UX_DESIGN.md` 与实现同步

---

## 七、与同类产品定位

| 产品 | 差异 |
|---|---|
| **draw.io** | 通用绘图，无领域语义轴（Who×Stage）、无 Agent/MCP |
| **Miro** | 协作白板，非结构化流程领域模型 |
| **n8n** | 工作流执行器，NodeFlow 是**流程设计/表达**工具 |
| **LangGraph Studio** | LLM 图编排专用；NodeFlow 是通用节点流程 + Agent 可操作 |

**差异化护城河**：Who/Stage 矩阵布局 + 组合节点 + MCP Agent 可编程操作 + 本机 Electron 桌面。

---

## 评估方法

- 三路并行深读（核心域与算法 / UI 与 Electron / Agent-MCP 与工程化）
- P0 缺陷逐行核实（`graphStore.ts` 快照字段对比、`agentBridge.ts` 请求路径）
- 修复后全量回归：447 用例 / 47 文件、`tsc`、`bun run build`
