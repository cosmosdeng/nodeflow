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
X axis = Stage / When
Y axis = Participant / Who
Node   = What
```

- Participant 与 Stage 是**正交语义轴**；Node 可同时拥有两者。
- 无语义轴（participants 与 stages 均不存在）时，`runSmartArrange` 仍使用传统 topology layout（`computeLayout`）。
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
Semantic assignment / semantic order
    >
Matrix geometry
    >
Stage-only Anchor
    >
Free Placement
    >
Elastic Band envelope
```

- topology 是**次级约束**，不能破坏语义轴硬顺序（Participant/Stage order）。

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
| 3 | Stage 是 X 轴语义 | PASS | `arrange.ts` cols; docs §5 |
| 4 | `participantOrder`/`stageOrder` 是语义硬顺序 | PASS | `arrange.ts` computeMatrixGridStructure; document.ts resolve*Order; docs §10 |
| 5 | topology 是次级约束 | PASS | `arrange.ts` 注释 + rank/level 仅排序; docs §9 |
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
