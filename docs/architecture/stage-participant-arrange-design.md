# Stage / Participant Arrange Geometry — Design Decision

> 状态：**Accepted (Spike-validated)** —— 2026-09-09，基于
> `src/lib/spikes/stageParticipantArrangeSpike.{ts,test.ts}` 与
> `src/lib/spikes/stageParticipantFixtures.ts` 的纯函数 Spike 验证。
> 本文档只冻结**架构决策与生产实现规格**，本身不修改生产代码。

> 历史注记（Phase 5D，2026-09-09）：下文 Context 中描述的 legacy 弹性带 internal layout
> `computeTopologyBandLayout` / `computeParticipantBandLayout` / `computeStageBandLayout`
> 已于 Phase 5D 从 `src/lib/arrange.ts` 删除（确认无 production/UI/Agent/MCP/Electron caller）。
> 本文档保留为 Phase 5A–5C 分析与决策的历史记录；当前 semantic Arrange 一律走
> `computeMatrixLayout`（`runArrange` 与 `runSmartArrange` 的 semantic 路径共用），
> 无 semantic 轴时 `runSmartArrange` 仍走 `computeLayout`。

---

## 1. Status

- **Accepted**。Spike 结论为“策略部分成立”（B），核心模型（统一 X=Stage / Y=Participant、四类按轴独立分类、topology 仅作次级排序/冲突检测、free 局部避让）在所有 fixture 上表现合理且优于现状，已具备正式设计与实现条件。
- 实现范围外待产品决策的细节见 [21. Open Questions](#21-open-questions)，本文件对已冻结项不做重复开放。

## 2. Context

- NodeFlow 存在两套语义组织轴：`Stage`（阶段域）与 `Participant`（参与方 / 组织）。
- 现状中同一份语义被三个模块各自解释一次，产生**分类与几何主轴的重复解释/分裂**：
  1. 视觉弹性带 `src/lib/elasticBands.ts`：**按轴独立**分类（assigned / rowOnly / **stageOnly** / free）。
  2. 工具栏自动排列 `runSmartArrange → computeTopologyBandLayout`：只按 **pid** 分类（无 pid 一律当 free，**把 stageOnly 当 free**），X 主轴 = **全局 topology 层**。
  3. 订单驱动排列 `runArrange → computeMatrixLayout`：只认 **pid+stage 双全**= 入矩阵，stageOnly 也算 free，X 主轴 = **Stage 列**。
- 由此产生的问题：
  - 视觉上被 Stage 竖带包住的节点，Arrange 却不排进该列；
  - 两条自动排列入口的 X 主轴不同（topology 层 vs Stage 列），几何语义分裂；
  - free 节点只要轻微压到行列带投影就被“整体弹到矩阵四角”，可能被弹到连线上游一侧（实测：`real_like` 中 `node5dd` 被弹 `(1479,388)→(398,464)`，位移 1157）。
- Spike 针对“Stage + Participant 带同时存在时应采用哪种 Arrange 几何模型”做了纯函数验证，测试证据见 [16. Evidence from Spike](#16-evidence-from-spike)。

## 3. Current Problem

1. **stageOnly 分类不一致**：`elasticBands.ts` 明确“不能因无 pid 把 Stage-only 丢弃，否则列带永不出现”，而两个 Arrange 模块都把它并入 free 处理。
2. **X 主轴分裂**：`computeTopologyBandLayout` 以全局 topology 层为 X，与 Stage 列带（When）语义脱钩。
3. **free 避让无距离成本与方向保护**：只要命中行带投影（哪怕 12px）即弹到整个矩阵区最近角落；不考虑连通子图；可能造成下游节点落到上游侧。
4. **入矩阵门槛过严**：必须 pid+stage 双全；真实“中间态”图（先画流程与阶段域、后补参与方）大量节点落 free。

## 4. Decision

- 在 **Stage + Participant 带模式存在**时，Arrange 使用**唯一、统一、与视觉带语义一致**的几何模型：

  - X 轴 = **Stage / When**（Stage order 决定列序）；
  - Y 轴 = **Participant / Who**（Participant order 决定行序）；
  - Node = What。
- Topology 不是第三个独立几何主轴，只作为 **cell 内排序 / 同带内排序 / anchor / 冲突检测**。
- 语义 Hard constraints（participantOrder / stageOrder / participantId / stage membership）在任何情况下不被几何“偷偷修改”。

## 5. Semantic Model

```text
Stage order ──→ X 主轴 (When,列)
Participant order ──→ Y 主轴 (Who,行)
Node = What(cell 内容)
```

- 用户显式定义的 `stageOrder` 决定列的语义顺序；`participantOrder` 决定行的语义顺序，均**不可由几何推导覆盖**。
- 视觉可见性（`showStageBands` / `showParticipantBands`）与语义存在性是两件事：隐藏带**不清除**语义。具体几何模式的选择取决于“启用的视觉轴 + 该轴语义是否存在”（部分细节标记为 implementation-stage decision，见 21）。

## 6. Node Classification（冻结）

统一四类 **domain classification**（与视觉带一致、按轴独立）：

```text
assigned   = participantId 有效 && stage 有效
rowOnly    = participantId 有效 && stage 无效
stageOnly  = participantId 无效 && stage 有效
free       = participantId 无效 && stage 无效
```

- **stageOnly 不是 free。rowOnly 也不是 free。**
- Participant 与 Stage 是两个正交语义轴；某轴缺失只意味着该轴“不参与矩阵约束”，不改变另一轴归属。
- **架构决策（冻结）**：未来生产代码应尽量只有一个权威分类 helper，概念上如：

  ```ts
  classifyNodeForMatrix(node, document) // 函数名实现阶段定
  ```

  它应同时被 Arrange、Elastic Band geometry 及必要的矩阵视觉逻辑使用，**消除三处重复解释**。
- 本次只写规格，**不实现该 helper**（属生产实现阶段 Phase 1）。

## 7. Stage-only Geometry

冻结语义：`stageOnly = { participantId: null, stageId: valid }`，必须：

1. 进入对应 **Stage column**；
2. 被对应 **Stage envelope** 包含；
3. 不创建虚拟 Participant；
4. 不进入 free；
5. 不改变 `participantId` / stage membership；
6. Y 位置由该 Stage column 内部几何规则决定。

**Y 定位规则（由 Spike 行为提炼为正式规格）**：

- 优先级：
  1. 复用该 Stage column 内已有 assigned 节点的空间（不与之重叠）；
  2. 该列内尽可能保持 topology 顺序（source 在 target 之前/上方）；
  3. 避免与 Participant rows 不必要重叠；
  4. 不创建虚拟 Participant row；
  5. 不改变其它节点 semantic assignment。
- 若某 Stage 无 assigned 节点，stageOnly 可使用该列的**独立 Y 基准**（Spike：从 `START_Y` 起，列内按 topology 层堆叠）。
- 明确：“**Stage-only 属于 Stage**”与“**Stage-only 属于 Participant**”是两个完全不同的问题；**不得为了几何方便给 stageOnly 自动补 participantId**。

## 8. Free Node Placement

`free = { participantId: null, stageId: null }`，不属于任何 matrix cell。

**禁止**再使用“只要碰到矩阵区域就直接弹到固定角落”策略。正式优先级（含 **P4 / P4B — 2026-09**）：

**禁入带（2026-09/P4B）**：free 节点矩形**不得与任何带相交** —— 行带（Participant，Y 区间）与列带（Stage，X 区间）
两个轴**独立**判定；**带约束优先于锚定**：锚到位压带时先沿冲突轴做最小位移移出带，宁可离上下游远一点也绝不压带。
只有真正发生冲突的那个轴才产生逃逸候选。调用方不提供带信息时无带约束（行为同 P4 之前）。

- **Level 0 — edge-aware anchor（P4, 2026-09）**：free 节点若有**已落位**的上游/下游邻居，先尝试贴到其流向上侧 ——
  仅连下游 → 贴下游左侧（上游位）；仅连上游 → 贴上游右侧（下游位）；上下游都有 → 落在两者水平间隙内居中
  （间隙放不下则退化为贴上游右侧）。锚定位与既有内容重叠时**不采用**，继续走下列序列；无连边信息时**不存在**锚定候选。
  处理顺序：先处理“有已落位邻居”的 free，再处理其余，使 `free → free → assigned` 链能逐段贴合。
- **Level 0.5 — band escape（P4B, 2026-09）**：把 Level 0（或原位）的结果沿冲突轴最小位移移出所有带，
  并同时避开已落位 Node 矩形；无法同时满足时继续走下列序列。
- **Level 1 — original**：锚定与解带都不成立时，原位无碰撞则保持原位。
- **Level 2 — local displacement**：±16 / ±32 / ±48 / ±64（或等价小幅搜索）内，以**最小位移**离开几何冲突
  （**优先选择同时满足带约束**的候选）；方向偏好固定为 `down > right > up > left`。
- **Level 3 — component peripheral**：local 无法解决时，在**相关连通分量已落位成员 bbox 外围**选最近合法位。
- **Level 4 — peripheral placement**：孤立 free 局部无法解决时，移到全部已落位内容 bbox 外围最近的合法位；仍尽量保持 `source.x <= target.x`，不因避让造成明显流程方向反转。

> Level 2–4 为兜底，但**带约束是绝对的**：写回位置前会再做一次带检查，仍压带则强制解带
> （必要时退到「带外四角」中最近的位置）。因此 free 节点在**任何情况下都不与任何带重叠**；
> 代价是极端情况下 free 节点可能远离其他内容（产品决策：带约束优先于锚定与就近）。

## 9. Topology Constraints（精确定义）

- **Hard constraints（不可破坏）**：participantOrder、stageOrder、participantId、stage membership、`node.position` 权威。
- **Soft constraints（可优化/可记录冲突）**：topology direction、topology layer、same-cell ordering、distance preservation、minimal displacement、edge crossing reduction。
- 原则：**Soft 永远不能通过破坏 Hard 来满足**。Soft 无法满足时输出 diagnostics（如 `topologyConflict` / `yReverse`），不静默改语义。

## 10. Stage Order vs Topology（冻结决策）

> **显式用户 Stage order 优先于自动推导的 topology X 顺序。**

- 例：用户定义 `S1 < S2`，实际连接 `S2 → S1`。仍保持 `x(S1) < x(S2)`，**不交换 Stage**；同时产生 `topologyConflict` 诊断。
- 不得：修改 stageOrder、自动交换 Stage、改 stage membership、改节点 Stage、为消冲突重排 Participant。
- 实测证据：Spike `real_like` 的 `composite→seed_4` 唯一 x 冲突即源于 stageOrder（`g1`/质检列序）与实际流向相反，是**真实语义冲突而非算法 bug**。

## 11. T16 Conflict（EXPECTED CONFLICT）

```text
A(P1,S1) → C(P3,S2) → B(P2,S3)
P1 < P2 < P3 ; S1 < S2 < S3
```

- Stage X 可满足 `A.x < C.x < B.x`；但 `C(P3) → B(P2)` 会形成 Participant **Y reverse**。
- 正式规则：这是 **EXPECTED CONFLICT，不是 bug**。Hard semantic axis 优先；Topology 只在不破坏 semantic axis 的范围内优化。冲突必须**可诊断**（Spike 输出 `yConflicts=[{C,B,y-reverse}]`），**不能静默改变语义**。

## 12. Elastic Band Relationship

```text
semantic/topology node layout
        ↓
node rectangles(node.position 权威)
        ↓
elastic band envelope(derived)
```

- Node 布局**先确定**；Band 是 Node geometry 的 **envelope**，不反向决定 Node 的 semantic assignment。
- Band 职责：containment、minimum gap、ordered envelope、visual organization。
- Band 不得：修改 Participant / Stage、改变 stageOrder / participantOrder、成为 Node 的 spatial parent。

## 13. Node.position Authority（冻结）

- `node.position` 仍是 Canvas geometry **唯一权威**。
- Stage / Participant band 是 **derived geometry**，不是 parent-child scene graph。
- 不引入 `laneId` / `laneBindingId` / 任何持久化几何绑定。

## 14. Unified Arrange Model

- 现状问题（冻结陈述）：`runArrange` 与 `runSmartArrange` 两条路径可能使用不同 X 主轴。
- 未来目标（冻结）：**在带模式下，所有自动排列入口最终使用同一套几何语义**：

  ```text
  Stage visible && Stage semantics exists
        ↓ X = Stage
  Participant
        ↓ Y = Participant
  ```

  而非：

  ```text
  Smart Arrange: X = topology
  普通 Arrange:  X = Stage
  ```

  即消除两条算法间的语义分裂。

## 15. Single-axis Fallback

- 无有效 Stage 语义时：`X = topology/flow ordering`，`Y = Participant`。
- 仅 Participant 带而无 Stage 语义：`Y = Participant`，`X = topology`。
- 仅 Stage 语义而无有效 Participant 语义：`X = Stage`，Y 轴细节单列（见 21 Open Question #2）。
- 通用原则（冻结）：**没有某个语义轴时，该轴不参与矩阵约束**。single-axis 的最终几何细节不在此提前重新设计。

## 16. Evidence from Spike

Spike 文件（纯函数、生产不 import）：

```text
src/lib/spikes/stageParticipantArrangeSpike.ts
src/lib/spikes/stageParticipantFixtures.ts
src/lib/spikes/stageParticipantArrangeSpike.test.ts
```

验证矩阵：

```text
vitest: 331/331 pass(35 files;含基线 312 无回归)
tsc:    clean
build:  pass
Spike:  19/19 pass
```

关键证据：

```text
real_like free 对比(同一输入):
  Current(computeTopologyBandLayout): node5dd → (398,464), distance = 1157
  Spike:                               node5dd → (1479,416), distance = 28
说明:Spike 明显减少 free 节点的非必要大位移,且保持 x(不弹到上游侧)。
```

stageOnly 验证（real_like）：

```text
seed_4 / chvx9j / g60uoi 均被分类为 stageOnly,全部进入对应 Stage column,
stageOnlyMisclassified = 0(不再被当 free)。
```

其余 fixture 覆盖：assigned/rowOnly/free 分类、stageOrder→X、participantOrder→Y、same-cell 拓扑不反向、split/merge/gateway、T16 EXPECTED CONFLICT、determinism、输入不变性。

## 17. Production Implementation Plan（只列顺序，不执行）

- **Phase 1**：抽取共享 classification helper（assigned / rowOnly / stageOnly / free），统一 `arrange.ts` / `elasticBands.ts` / 必要视觉逻辑的分类来源。
- **Phase 2**：统一 dual-band Arrange：`X = Stage`、`Y = Participant`（收敛 `runSmartArrange` 与 `runArrange` 语义分裂）。
- **Phase 3**：迁移 stageOnly / rowOnly 到新几何路径（stageOnly 进列、rowOnly 留行延伸区）。
- **Phase 4**：改造 free placement：local displacement → component preservation → peripheral fallback。
- **Phase 5**：加入 conflict diagnostics：`topologyConflict` / `yReverse` / `containmentConflict`。
- **Phase 6**：Elastic Bands 完全消费统一后的 Node geometry（envelope 层不再自建分类）。
- **Phase 7**：更新 / 增加正式测试（见 §18）。

## 18. Test Requirements（正式实现至少覆盖）

```text
classification / stageOnly / rowOnly / assigned / free
stageOrder / participantOrder
same-cell topology / split / merge / gateway
cross-participant / cross-stage
free local displacement / free component displacement
stageOrder vs topology conflict
T16(EXPECTED CONFLICT)
determinism / repeated arrange / undo/redo / save/reload
```

特别要求：**Arrange 不得改变 semantic assignment**（participantId / stage membership / participantOrder / stageOrder 均不变）。

## 19. Open Questions（仅保留真正未冻结项）

1. **Stage-only 与 assigned 在同一 Stage column 内的精确 Y anchor**：Spike 采用“同列 assigned 最大 bottom 之后起、无 assigned 则独立基准”，该规则的正式细化（含与行带 y 的可选对齐）尚未冻结。
2. **single-axis 模式的最终几何细节**：仅 Stage 或仅 Participant 一条带可见时，另一轴缺失下的具体排布规则（Spike 的 `computeStageBandLayout` / `computeParticipantBandLayout` 降级语义）未全部冻结。
3. **topology conflict 的 UI 呈现方式**：冲突以何种形式暴露给用户（画布标记 / 面板 / 仅日志）未定。
4. **是否需要正式的 Arrange diagnostics API**：`topologyConflict` / `yReverse` 等是否进入 Agent Interface / MCP 可查询范围未定。

## 20. 文档位置与归属

- 本文件：`docs/architecture/stage-participant-arrange-design.md`
- 不覆盖、不删除既有架构记录（如 `agent-development-status.md`）；不改动任何代码 / Spike / 测试。
- 相关既有代码参考：`src/lib/arrange.ts`、`src/lib/elasticBands.ts`、`src/store/graphStore.ts`、`src/components/MatrixVisualLayer.tsx`、`src/types.ts`。

---

### 冻结摘要

- **唯一几何模型**：带模式下 X=Stage(order)、Y=Participant(order)，Node=What；Topology 仅为次级排序 / 冲突检测，不是第三几何主轴。
- **统一四类分类**：assigned / rowOnly / stageOnly / free，按轴独立；**stageOnly、rowOnly 不是 free**。
- **Stage-only**：进列、被 Stage envelope 包含、不造虚拟 Participant / 行、Y 由列内几何规则决定。
- **Stage order > topology X**；冲突诊断、不交换语义。
- **T16 的 C→B Y-reverse 为 EXPECTED CONFLICT**。
- **free**：Level1 局部小幅 → Level2 连通子图整体 → Level3 外围；禁止一碰就弹固定角。
- **Elastic Band = Node geometry 的 envelope**，不改语义；`node.position` 仍唯一权威，不引入 lane 绑定。
