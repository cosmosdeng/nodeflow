---
name: nodeflow
display_name: NodeFlow 流程画布
display_name_en: NodeFlow Canvas
description: 当用户需要操作 NodeFlow 流程画布(创建节点、连线、分配参与方/阶段、自动排列、检查流程、截图)时使用。先观察再修改,修改后用断言验证。
description_zh: 操作正在运行的 NodeFlow 流程画布:创建/编辑节点与连线、分配参与方与阶段、自动排列、断言验证与截图。
description_en: Operate a running NodeFlow process canvas: create/edit nodes and edges, assign participants and stages, arrange, assert and screenshot.
version: 1.0.0
author: cosmosdeng
---

# NodeFlow 流程画布操作指南

当用户要求操作 NodeFlow 流程画布(创建流程、修改节点、安排布局、查看或截图画布)时使用本 Skill。所有操作都通过 NodeFlow Connector 暴露的 MCP 工具完成。

## 1. Observe first(先观察)

在创建或修改任何内容之前,先调用 `get_graph_state` 或 `get_nodes` / `get_edges` / `get_participants` / `get_stages`,了解当前画布已有的节点、连线、参与方与阶段,避免重复创建或误改。

- 若画布为空(没有节点),从创建节点开始。
- 若用户提到"参与方 / 组织 / 谁来做",关注 participant。
- 若用户提到"阶段 / 什么时候 / 流程顺序",关注 stage。

## 2. Semantic structure(语义模型)

NodeFlow 以"流程语义"组织画布:

- **Node = What / 做什么**(动作单元,可配置执行主体)。
- **X 轴 = Stage(阶段)/ When**:`create_stage`、`assign_stage` 把节点归入对应阶段。
- **Y 轴 = Participant(参与方)/ Who**:`create_participant`、`assign_participant` 表示由谁执行。
- **Edge = 流转关系**:用 `connect_edge` 连接节点。
- 还有 Gateway(网关/分支)、Artifact(连线上的中间产物)、Annotation(注释)、Composite(组合节点)等。

创建顺序建议:先建参与方与阶段,再建节点,再连线,最后 `arrange` 排列。

## 3. Safe mutation(安全修改)

- 修改前先通过查询确认目标存在(id、label)。
- 遵循循环:`Observe → Act → Observe → Verify`。每一步修改后查询结果,确认符合预期再继续。
- `update_node` / `assign_participant` / `assign_stage` / `move_node` 只改变语义或单个属性,不自动重排。

## 4. Arrange(排列)

- 创建/大量修改节点或归属后,可调用 `arrange` 让 NodeFlow 按语义自动排列(参与方×阶段矩阵或拓扑布局)。
- **不要**在每次微小改动后都调用 `arrange`;只在用户要求"排列 / 整理 / 对齐",或批量改动完成后调用,以免打乱用户已手动调整的布局。

## 5. Assertions(验证)

完成一组操作后,使用 `assert` 验证关键结果:

- `assertNodeExists` / `assertEdgeExists`:结构存在性;
- `assertParticipantAssignment` / `assertStageAssignment`:语义归属;
- `assertGatewayType` / `assertEdgeArtifact` / `assertAnnotationExists`:跨域对象;
- `assertNoOverlap` / `assertNodeInsideParticipant` / `assertNodeInsideStage`:几何正确性。

断言返回结构化结果(`passed` / `actual` / `expected`),不要只凭截图猜测。

## 6. Screenshot(截图)

当用户要求"看一下图 / 确认布局 / 检查视觉结果"时,调用 `screenshot`(`target: canvas` 截画布;需要整窗时用 `window`)。

## 7. Undo(撤销)

- 如果一次修改不符合预期,优先调用 `undo` 回退一步,而不是继续追加错误修改。
- 修改前可先记录 `revision`,便于判断是否真的产生了变化。

## 安全边界(重要)

- 所有操作只通过 NodeFlow Connector 的 MCP 工具完成。
- 不要直接修改 NodeFlow 文件、编辑 JSON、访问数据库、执行 shell、或触碰 Electron/浏览器内部状态。
- 不执行 `reset` / `seed_fixture`(测试专用,普通 Connector 未开放)。
- NodeFlow 必须正在运行(Connector 通过本机 Agent Bridge 连接它);若工具返回 `BRIDGE_UNAVAILABLE`,提示用户先启动 NodeFlow。
