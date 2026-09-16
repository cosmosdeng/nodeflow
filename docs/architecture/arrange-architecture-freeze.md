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

- Band 是从 Node geometry **派生**的 envelope；Band 不拥有 Node；Band 不被 Node 移动。
- **禁入带（2026-09 / P4B）**：free 节点落位时，行带 Y 区间 / 列带 X 区间作为「禁入区」参与判定（见 §22）；
  这仍然只是「Node 不许压带」，Band 依旧不拥有 Node，且 **assigned / rowOnly / stageOnly 的落位完全不受 Band 影响**。
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
Free Placement:
    band-escape (禁入带, 2026-09/P4B) > anchor (贴上下游, P4) > original > local / component / peripheral
    >
Elastic Band envelope (渲染)
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
| 10 | Band 不参与 assigned/rowOnly/stageOnly 落位；仅作为 free 的禁入带 | PASS (2026-09/P4B 修订) | `computeMatrixLayout` 的行/列/Anchor 均不使用 Band；free 分支传 `rowBands`/`colBands` → freePlacement Level 0.5; docs §22 |
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

## 21. Revision 2026-09 (P4) — edges 接线 + Free 节点贴流程

> 本条修正 §20 的一个**接线缺口**，并新增 P4 的 free 锚定行为。

### 21.1 §20 的接线缺口（重要）

§20 的「列内 X = 拓扑层」依赖调用方传入 `edges`；但 `graphStore` 的 `runArrange` / `runSmartArrange`
当时**未传** `edges`，导致列内层信息恒为空（每列只有一层）—— 即 §20 的几何在应用中**实际未生效**。本修订补齐接线：

```text
graphStore.runArrange      → computeMatrixLayout(input, { edges: s.edges })
graphStore.runSmartArrange → computeMatrixLayout(input, { edges: s.edges })
```

无 `edges` 时行为仍退回「同列按 Y 堆叠」，纯函数缺省契约不变。

### 21.2 P4 — Free 节点连线锚定

`freePlacement.ts` 新增 **Level 0 anchor**（详见 design doc §8）：

- 仅连下游 → 贴下游左侧（上游位，纵向居中）；
- 仅连上游 → 贴上游右侧（下游位，纵向居中）；
- 上下游都有 → 两者水平间隙内居中；间隙放不下 → 退化为贴上游右侧；
- 锚定位不合法（与已落位内容重叠）→ **不采用**，继续走 original → local → component → peripheral；
- 无连边信息 → 无锚定候选，行为与 P4 之前完全一致；
- 处理顺序：先「有已落位邻居」的 free，再其余（使 `free → free → assigned` 链可逐段贴合）。

`PlacementLevel` 新增 `'anchor'`；`freePlacement.ts` 头注释与 design doc §8 同步更新。

### 21.3 受影响测试（按新语义更新）

`src/lib/__tests__/freePlacement.test.ts`：
- 「component:local 失败…」→ 拆为「anchor：有已落位上游 → 贴上游右侧」+「anchor 位被占 → 退回 component」。
- 「Production 与 Spike 一致性」→ 限定为**无连边输入**（spike 是 Phase 4B 基线，不含锚定）；
  带连边输入的差异单独断言（production = anchor / spike = 回退）。

`src/store/__tests__/graphStore.order.p3.test.ts`、`graphStore.participant.test.ts`：
- 接线 `edges` 后列内 X 分层生效，原有「同 cell 纵向堆叠 / 同列同 x」断言改为
  「行带 Y 拉平 + 列内按拓扑层 X 递进」。

### 21.4 验证

```text
Vitest:     42 files / 405 tests passed
TypeScript: tsconfig.json exit 0; tsconfig.electron.json exit 0
Build:      bun run build exit 0
```

### 21.5 相关文件

- `src/store/graphStore.ts`（传入 `edges`）
- `src/lib/freePlacement.ts`（Level 0 anchor）
- `src/lib/__tests__/freePlacement.test.ts`
- `src/store/__tests__/graphStore.order.p3.test.ts`、`graphStore.participant.test.ts`
- `docs/architecture/stage-participant-arrange-design.md` §8

## 22. Revision 2026-09 (P4B) — Free 节点禁入带（行带 ∪ 列带）

> 产品决策：free 节点**不得压在带上**，且**带约束优先于锚定**（宁可离上下游远一点，也绝不压带）。

### 22.1 变更内容

`freePlacement.ts` 新增可选输入 `rowBands`（行带 Y 区间）/ `colBands`（列带 X 区间）与 **Level 0.5 band-escape**：

- 两轴**独立**判定：节点 Y 区间不得与任何行带相交；节点 X 区间不得与任何列带相交；
- 只有**真正冲突的那个轴**才产生逃逸候选（另一轴不动）；候选 = 每个禁入区间两侧 + 整体置于所有区间之前/之后；
- 候选按「总位移最小」排序，取第一个既不压带、又不与已落位 Node 重叠者；全不合法则退回既有序列；
- **顺序**：anchor(P4) → band-escape → original → local（优先选同时满足带约束者）→ component → peripheral；
- `PlacementLevel` 新增 `'band'`；
- 未传带信息时**不存在**逃逸候选，行为与 P4 完全一致（纯函数缺省契约不变）。

`arrange.ts` 在 free 分支由几何派生并传入：

```text
rowBands = rowYs / rowBottoms → [{ top, bottom }]
colBands = colXs / colRights  → [{ left, right }]
```

### 22.2 受影响测试（按新语义更新，非删除）

- `src/lib/__tests__/freePlacement.test.ts`：碰撞用例改为断言「移出带并避开 Node」，确定性解 `(-160,-70)`。
- `src/lib/__tests__/matrixGrid.test.ts`：原「不用 band 当 obstacle」用例改为「带约束优先 → 移出带」，确定性解 `(368,230)`。

### 22.3 已验证的端到端形态

同一份图（行带 Y `[80,270] [350,540]`；列带 X `[80,648] [768,1336]`）：

```text
需求收集(free)   (-150, -110)   压行带=0 压列带=0   ← 移到行带之上、列带之左
脚本编写         ( 104,   80)   压行带=1 压列带=1   ← assigned 落位不受带影响
```

### 22.4 验证

```text
Vitest:     42 files / 406 tests passed
TypeScript: tsconfig.json exit 0
Build:      bun run build exit 0
```

新增不变量测试：`freePlacement.test.ts > P4B 绝对保证` —— 遍历全部 fixture，断言每个 free 节点
与其行带 / 列带**零重叠**（覆盖全部兜底路径）。

### 22.5 已知取舍

- 行带横贯全宽、列带纵贯全高，「两种带都不压」会显著压缩 free 节点的可用位置：
  节点尺寸大于带间隙时只能落在矩阵**外侧**（上/下 × 左/右）。这是产品明确选择的约束。
- 带约束是**绝对的**：写回位置前有最终带检查，仍压带则强制解带（必要时退到「带外四角」中最近位）；
  因此 free 节点在任何情况下都不与带重叠，代价是极端情况下它会远离其他内容。
- **边上的中间产物 chip（`edge.data.artifact`）不是 Node**，由 `FlowEdgeComponent` 按连线标签位渲染，
  不参与 Arrange，因此仍可能压在带上（只要连线穿过带）。这是渲染层行为，不在本冻结范围内。

### 22.6 相关文件

- `src/lib/freePlacement.ts`（禁入带输入 + `axisCandidates` / `escapeFromBands`）
- `src/lib/arrange.ts`（派生并传入 rowBands / colBands）
- `src/lib/__tests__/freePlacement.test.ts`、`src/lib/__tests__/matrixGrid.test.ts`
- `docs/architecture/stage-participant-arrange-design.md` §8
