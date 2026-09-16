# NodeFlow Arrange — Architecture Freeze (Phase 7)

> 状态：**Frozen (audited 2026-09-16)**。
> 本文件是 Phase 7 的**冻结状态与审计证据聚合文档**（指针文档），不重复 `stage-participant-arrange-design.md`
> 已有的几何决策细节；后者是**几何/语义规格的唯一权威**，本文件引用它并记录冻结声明、21 条核心
> Invariant 验证、入口边界、deferred backlog 与验证基线。
>
> 冻结目标：除非出现明确的新产品需求、明确的架构缺陷或 P0/P1/P2 regression，否则不再修改
> Arrange 核心算法与语义模型（`arrange.ts` / `matrixClassification.ts` / `stageOnlyAnchor.ts` /
> `freePlacement.ts` / `elasticBands.ts` 的几何行为）。

## 1. Scope

本冻结范围仅覆盖 **Arrange / Smart Arrange / Participant / Stage / Elastic Band / Semantic Reassignment**。

**不覆盖**（冻结声明之外）：
- 业务执行引擎 / Workflow Runtime / 业务流程执行模型；
- Agent/MCP 新功能；
- Legacy Swimlane 的未来产品去留（见 Deferred Backlog）。

## 2. Frozen Product Model

```text
X axis = Stage 列区域(有序) / When ;列内 X = 全局拓扑层(上游在左、下游在右)
Y axis = Participant / Who
Node   = What
```

- Participant 与 Stage 是**正交语义轴**；Node 可同时拥有两者。
- 无语义轴（participants 与 stages 均不存在）时，`runSmartArrange` 仍使用传统 topology layout（`computeLayout`）。
- **X 语义（2026-09 修订）**：Stage 决定**列区域及其顺序**（`stageOrder` 硬顺序不变）；列内 X 由**全局拓扑层**决定 —— 同一 Stage 列内上游靠左、下游靠右，允许同列横向错开，使「从左到右 = 上游→下游」成立。Y 在同一 Participant 行带内拉平（不再按层逐格下沉）。详见 §20。
- 规格权威：`stage-participant-arrange-design.md` §4–§13。

## 3. Node Classification

唯一共享 authority：`src/lib/matrixClassification.ts` 的 `classifyMatrixNode`，四类：

```text
assigned  = participant 有效 && stage membership 有效
rowOnly   = participant 有效 && stage 无效
stageOnly = participant 无效 && stage 有效   ← stageOnly !== free
free      = participant 无效 && stage 无效   ← rowOnly   !== free
```

## 4. Geometry Authority

```text
node.position = 唯一 Node geometry authority
```

- Band 是从 Node geometry **派生**的 envelope；Band 不拥有 Node；Band 不参与 Node placement。
- **不存在** `laneId` / `laneBindingId` / 其它持久化绑定字段。
- MatrixVisualLayer / elasticBands **只读**，不反向写 `node.position`。

## 5. Arrange Entry Points

| 入口 | 调用 | 位置 |
| --- | --- | --- |
| `runArrange` | → `computeMatrixLayout` (unified matrix) | `src/store/graphStore.ts` |
| `runSmartArrange`（有 Participant/Stage 语义轴） | → `computeMatrixLayout` | `src/store/graphStore.ts` |
| `runSmartArrange`（无语义轴） | → `computeLayout` (legacy topology) | `src/store/graphStore.ts` |
| `arrangeAllSwimlanes` | → `arrangeSwimlanes` (Legacy, 保留) | `src/store/graphStore.ts` |
| `toggleSwimlane` / `computeSwimlaneBounds` / `arrangeSwimlanes` | Legacy compatibility | `src/store/graphStore.ts` / `src/lib/arrange.ts` |

## 6. Constraint Priority

```text
Semantic assignment / semantic order (Stage 列区域顺序 / Participant 行顺序)
    >
Intra-column topology layer (列内 X 槽位:上游在左、下游在右)
    >
Stage-only Anchor
    >
Free Placement
    >
Elastic Band envelope
```

- 拓扑**不能**破坏语义轴硬顺序（Stage 列区域顺序 / Participant 行顺序）；冲突时保留语义顺序，并把拓扑冲突写入 diagnostics（EXPECTED CONFLICT）。
- 列内层槽位依赖连边信息：调用方未提供 `edges` 时无层信息可用，退回「同列按 Y 堆叠」（`rankOf` / `position.y → x → id` 稳定序）。

## 7. Semantic Reassignment

- 普通拖动**不改变**语义（`FlowCanvas` 的 drag 只维护 hover/dwell/highlight runtime 状态）。
- 交互：dwell + highlight + 显式确认。
- Participant 与 Stage 两个轴**独立**确认，不因几何交叉自动同时推断。
- 取消不改变语义；确认 = `reassignNode` 原子事务（一次 Undo/Redo）。
- 规格权威：`src/lib/semanticReassignment.ts`、`src/components/FlowCanvas.tsx`。

## 8. Undo / Persistence

- Arrange 是一次原子 Undo 操作（`runArrange` / `runSmartArrange` 的 `markHistory` + 一次 `set`）。
- Semantic reassignment 原子（drag start 快照 + `reassignNode` `recordHistory:false`）。
- Participant/Stage 顺序持久化在 v5 document（`participantOrder` / `graph.stageOrder`）。
- Save/Reload 保持语义（participants/stages/membership/order）与几何（`node.position`）。

## 9. Legacy Swimlane Boundary

- `SWIMLANE_UI_VISIBLE=false`（`src/components/Toolbar.tsx`）；UI 入口（开关/整理）已隐藏，实现保留。
- `LEGACY_SWIMLANE_VISUAL=false`（`src/components/FlowCanvas.tsx`）；legacy 泳道渲染隔离，不再渲染。
- 相关行为代码（`arrangeSwimlanes` / `arrangeAllSwimlanes` / `computeSwimlaneBounds` / `toggleSwimlane`）保留。
- 与 unified Arrange 隔离；是否最终移除 = **deferred product decision**。

## 10. Known Limitations

- T16 类语义顺序与拓扑方向冲突时，**保留语义顺序**并记录拓扑冲突（EXPECTED CONFLICT）。
- 部分视觉细节仍需要人工 QA（如弹性的产物观感）。
- Legacy Swimlane 的最终去留尚未决定。
- Arrange diagnostics / conflict visualization 尚未作为正式产品功能实现。

## 11. Non-goals

本冻结阶段不做：
- 全局迭代优化器；
- 自动改变 Participant/Stage 语义；
- Band parent / scene graph；
- 业务流程执行；
- 自动解决所有拓扑冲突。

## 12. Verification Evidence

见下方 §14 Invariant Audit 与 §4 Baseline。不虚构测试名 / 路径 / 数量。

---

## 13. Baseline (2026-09-16)

```text
Branch:     next
HEAD:       05cc2fa
Working tree: dirty (9 modified + 11 untracked) —— 保留，等待人工审阅
Vitest:     42 files / 403 tests passed
TypeScript: tsconfig.json exit 0; tsconfig.electron.json exit 0
Build:      bun run build exit 0 (仅 chunk size 警告, 非阻断)
Diff check: git diff --check exit 0
```

## 14. Invariant Audit

| # | Invariant | Status | Evidence |
| - | - | - | - |
| 1 | `node.position` 是唯一 Node geometry authority | PASS | MatrixVisualLayer 无 setNodes/position 写回; arrange.ts 只写 `result` Map; document.ts v5 保存 nodes.position |
| 2 | Participant 是 Y 轴语义 | PASS | `arrange.ts` MATRIX rows; docs §5; Toolbar title |
| 3 | Stage 决定 X 列区域与列区域顺序；列内 X = 全局拓扑层 | PASS (2026-09 修订) | `arrange.ts` `colLayerIndex`/`colOffsetOf`/`MATRIX_LAYER_GAP`; docs §20 |
| 4 | `participantOrder`/`stageOrder` 是语义硬顺序 | PASS | `arrange.ts` computeMatrixGridStructure; document.ts resolve*Order; docs §10 |
| 5 | topology 决定列内 X 层槽位，但不破坏语义轴硬顺序 | PASS (2026-09 修订) | `arrange.ts` `computeLevels` → 列内槽位 + conflict diagnostics; docs §20 |
| 6 | 节点统一分为 assigned/rowOnly/stageOnly/free | PASS | `matrixClassification.ts` classificationFromAxes |
| 7 | stageOnly 进对应 Stage 列 + Stage-only Anchor | PASS | `arrange.ts` stageOnly 分支 → `computeStageOnlyColumnAnchors` |
| 8 | free 使用 Free Placement | PASS | `arrange.ts` free 分支 → `computeFreeNodePlacements`; freePlacement.ts |
| 9 | Elastic Band 是 Node geometry envelope | PASS | `elasticBands.ts` 头注释 "Band 不移动 Node" |
| 10 | Band 不参与 Node placement | PASS | `computeMatrixLayout` 无 Band obstacle; freePlacement.ts 注释 "Band 不是 obstacle" |
| 11 | `runArrange` 使用 `computeMatrixLayout` | PASS | graphStore.ts:2110 |
| 12 | 有语义轴时 `runSmartArrange` 使用 `computeMatrixLayout` | PASS | graphStore.ts:2211 |
| 13 | 无语义轴时 `runSmartArrange` 使用 legacy `computeLayout` | PASS | graphStore.ts:2161–2174 |
| 14 | Semantic reassignment 必须显式确认 | PASS | FlowCanvas reassignRequest confirm; semanticReassignment.ts confirmCandidate |
| 15 | 普通拖动不隐式改变语义归属 | PASS | FlowCanvas drag 仅 hover/dwell; 语义唯一入口 reassignNode |
| 16 | Participant/Stage 两轴可独立确认 | PASS | semanticReassignment.ts §; reassignNode patch 独立 |
| 17 | Arrange 是原子 Undo 操作 | PASS | graphStore.ts runArrange/runSmartArrange markHistory+一次 set |
| 18 | Arrange 不改变语义数据 | PASS | runArrange 只更新 nodes.position |
| 19 | Save/Reload 保持语义+几何 | PASS | document.ts v5 build/parse participants/stages/order/nodes |
| 20 | 已删除三个 legacy Band layout 算法 | PASS | 无 computeTopologyBandLayout/computeParticipantBandLayout/computeStageBandLayout 残留; design doc §1 历史注记 |
| 21 | Legacy Swimlane 与 unified Arrange 隔离 | PASS | arrangeSwimlanes 独立保留; SWIMLANE_UI_VISIBLE/LEGACY_SWIMLANE_VISUAL=false |

## 15. Module Boundary Audit

- **PASS**：
  - 纯算法模块（matrixClassification / stageOnlyAnchor / freePlacement / matrixTargets / semanticReassignment）无 React / DOM / Store / 随机 / Date 依赖，均为纯函数。
  - `node.position` 未被其它几何系统夺权（渲染只读）。
  - Elastic Band 不反向写 position。
  - Semantic reassignment 未被普通拖动路径绕过。
  - 三个 legacy Band 布局函数无生产残留引用。
  - Legacy Swimlane 代码仅独立兼容存在。
- **Observation**：
  - `src/lib/spikes/` 含 spike 测试（`stageParticipantArrangeSpike.test.ts` 计入 403 测试总数），属于实验验证资产；建议明确其长期收敛策略（保留为基线 vs 归档）。
- **后续处理**：无核心架构项；spike 目录归属为工程整理项（不阻塞冻结）。

## 16. Documentation

- 新增：本文件 `docs/architecture/arrange-architecture-freeze.md`（Phase 7 冻结状态 + 审计证据聚合）。
- 既有（引用，未重复）：`docs/architecture/stage-participant-arrange-design.md` 为几何/语义规格权威。
- 一致性：README 无对 Arrange 的过时表述；Toolbar tooltip 文案与当前行为一致（"存在语义轴按矩阵排列；无语义轴等同纯拓扑"）；design doc 中的旧问题描述已标注为历史 Context。

## 17. Code Changes

```text
No production code changes.
```

本阶段仅新增一份冻结审计文档，未修改任何生产代码 / 测试 / 算法。

## 18. Deferred Backlog

1. Legacy Swimlane 是否最终删除（product decision）。
2. Arrange diagnostics / conflict visualization 作为正式产品功能。
3. Elastic Band 视觉细节优化（QA）。
4. 完整的渲染层鼠标手势自动化测试。
5. Zoom/Pan 下真实 hit-test 自动化测试。
6. 后续业务引擎与流程执行模型。
7. `src/lib/spikes/` 实验资产的长期收敛策略。

## 19. Final Verdict

```text
READY FOR ARCHITECTURE FREEZE
```

## 20. Revision 2026-09 — X = 拓扑层（产品需求驱动的变更）

> 依据冻结条款「除非出现明确的新产品需求」——本变更为**明确的产品观感需求**
> （自动排列应「从左到右 = 上游→下游」），经原型对比人工确认后实施。语义数据模型未变。

### 20.1 变更内容

| 项 | 变更前 | 变更后 |
| - | - | - |
| 列内 X | 一律 `colXs[c] + CELL_PAD_X`（贴列左缘，同列同 x） | `colXs[c] + CELL_PAD_X + layerIndex(全局拓扑层) × (列最大节点宽 + 60)` |
| 列宽 | 该列最宽节点 | max(列内层槽位总宽, 该列 stageOnly 最宽) |
| 行内 Y | 按全局层「逐格下沉」（`assignFlowLevels`） | 同一行带内拉平；仅同 (row, col, 层) 组内纵向堆叠 |
| Stage 角色 | X 轴精确定值 | 列区域 + 列区域顺序（`stageOrder` 仍为硬顺序） |

- 新增常量 `MATRIX_LAYER_GAP = 60`（同列相邻拓扑层水平间距）。
- `MatrixGridGeometry.cells` 项新增 `colOffset`（列内层槽位偏移）。
- 删除已被取代的 `assignFlowLevels`（旧的行内层下沉分配）。
- 调用方未提供 `edges` 时无层信息 → 退回「同列按 Y 堆叠」，与变更前行为一致。

### 20.2 语义不变量保持

- `participantOrder` / `stageOrder` **不变**，几何仍严格按其顺序（列区域顺序 / 行顺序）。
- Stage 顺序与拓扑方向冲突时：**Stage 优先**，冲突只记录、不做隐式语义改写。
- 四类分类、stageOnly Anchor、Free Placement、Elastic Band envelope、Undo / 持久化 均未改动。

### 20.3 受影响测试（按新语义更新，非删除）

`src/lib/__tests__/matrixBandLayout.test.ts`：
- 「同参与方跨 Stage 流等级对齐」→ 「列内拓扑层 X 分层 + 行带 Y 拉平」（断言下游在右、同带 Y 一致）。
- T3（同 Participant 跨 Stage 单链）→ 断言 Y 一致且 X 递增（原断言 270 / 460 的逐格下沉）。
- T4（同 cell 直接依赖）→ 断言 X(source) < X(target) 且 Y 一致（原断言 Y 下沉）。
- T5（Merge）→ 断言源与汇合点同带、汇合点在右（原断言汇合点下沉到 270）。

### 20.4 验证

```text
Vitest:     42 files / 403 tests passed
TypeScript: tsconfig.json exit 0
Build:      bun run build exit 0
```

### 20.5 相关文件

- `src/lib/arrange.ts`（`computeMatrixGridGeometry` 列内层槽位 + 行带拉平；`computeMatrixLayout` X 写入）
- `src/lib/__tests__/matrixBandLayout.test.ts`
- 本文件 §2 / §6 / §14（#3、#5）
