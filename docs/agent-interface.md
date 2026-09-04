# NodeFlow Agent Interface & Local Test Bridge

> MCP is an adapter, not the core protocol.

## 1. Architecture

```text
Agent(CodeBuddy / 测试脚本 / 未来 MCP)
  ↓  HTTP / JSON(仅本机)
Local Test Bridge(Electron 主进程,127.0.0.1,默认关闭)
  ↓  白名单 IPC channel
Renderer Agent Core(executor)
  ↓
现有 Store 业务动作(Domain / History)
  ↓
Graph State → Persistence / Canvas Visual
```

原则：
- Agent 永远只看到稳定 DTO / 结构化错误，不接触 Zustand internals / React state / 任意 JS。
- Agent Command 复用现有业务逻辑（node/participant/stage CRUD、assignment、arrange、undo/redo、reassign）。
- 没有 `eval`、`executeJavascript`、arbitrary IPC、filesystem/shell 暴露。

## 2. Agent Interface 原则

1. Observe → Act → Observe → Verify。
2. Command 必须经“一次 mutation transaction → 一次 history entry → 一次 revision”。
3. 语义与几何分开：`assignParticipant/assignStage` 只改语义，不自动重排；几何由 `arrange` 显式执行。
4. revision 是 runtime Agent state，不属于 `.nodeflow` persistence schema。

## 3. Query API(Observe)

| type | 返回 |
|---|---|
| getDocument | documentId / activeTabId / 计数 |
| getNodes | AgentNodeDto[]（含 participantId / stageId / composite / gateway） |
| getEdges | AgentEdgeDto[] |
| getParticipants | AgentParticipantDto[] |
| getStages | AgentStageDto[] |
| getViewport | {x,y,zoom} |
| getSelection | {kind,id} 或 null |
| getGraphState | revision + 全部 DTO |

## 4. Command API(Act)

createNode / updateNode / deleteNode / moveNode / assignParticipant / assignStage
createParticipant / updateParticipant / deleteParticipant
createStage / updateStage / deleteStage
connectNodes / deleteEdge / arrange / undo / redo
createGateway / changeGatewayType
attachArtifact / updateArtifact / removeArtifact
createAnnotation / updateAnnotation / deleteAnnotation / moveAnnotation
reset / seedFixture(仅 Local Test Bridge 用)

Node DTO 派生表达 Composite(childIds / parentCompositeId)与 Gateway(gatewayType);
Edge DTO 携带 edge.data.artifact;getAnnotations 观察注释。Composite 的 host 创建
沿用既有 GUI 动作(groupSelected),Agent 侧当前为 Observe+Assert(见报告 Findings)。

每个成功 mutation 返回：

```json
{ "previousRevision": 12, "newRevision": 13 }
```

- arrange 调用现有 runSmartArrange(与工具栏一致)，Agent 侧不复制任何布局/弹性带/排序算法。
- moveNode = 一次 position 变更(原子历史)。

## 5. Assertion API(Verify)

assertNodeExists / assertEdgeExists / assertParticipantAssignment / assertStageAssignment
assertNodeInsideParticipant / assertNodeInsideStage / assertNoOverlap / assertBandVisible / assertBandOrder / assertNodePosition

返回：`{ passed, assertion, actual, expected, message }`
失败不抛无结构异常：结构化 `ASSERT_NOT_PASSED`。

语义断言(participantId / stage membership)与几何断言(band containment / overlap)严格分开。

## 6. Screenshot API(Visual)

getCanvasScreenshot / getWindowScreenshot

```json
{ "format": "png", "mimeType": "image/png", "data": "<base64>", "width": …, "height": … }
```

- Canvas 截图：renderer `html-to-image`(.react-flow)。
- Window 截图：优先 Electron `webContents.capturePage`。

## 7. State Revision

> `agentRevision` 是 Graph Runtime 的统一观察 revision(不是“Agent API 请求序号”)。

- Graph mutation 会增加 revision(GUI 与 Agent 均如此——统一由 Store Graph Mutation Authority 的指纹订阅推进)。
- Query 不增加 revision。
- Failed command 不增加 revision。
- Undo / Redo 是 Graph mutation,因此增加 revision。
- 语义未变化(assign 同值等)的 mutation 不增加 revision。
- revision 不属于持久化 GraphDocument;不属于 Undo Snapshot;reload 后允许归零(runtime 态)。

## 8. History Semantics

- Agent mutation = 一条 history entry(与 GUI 同一 undo 单元)。
- assignParticipant/assignStage/moveNode/arrange 均一次 Undo 还原。
- 不会因为 Bridge 增加多余历史。

## 9. Local Bridge

- 仅本机：`127.0.0.1:8787`(可用 `NODEFLOW_AGENT_BRIDGE_PORT` 覆盖)。
- 默认关闭：只有 `NODEFLOW_AGENT_BRIDGE=1` 时启动；生产/普通用户不受影响。

### Capabilities

```text
graph.read / graph.write / graph.assert / graph.screenshot / test.fixture
```

- `test.fixture`(reset / seedFixture)默认关闭；仅当 `NODEFLOW_AGENT_TEST_CMDS=1` 时可用。
- Bridge enabled ≠ test capabilities enabled。
- 未开启时返回结构化 `CAPABILITY_NOT_ENABLED`(不是 404 / unknown command)。
- 未来 MCP 应对应抽象 capability(`test.fixture`),不感知具体环境变量。
- 端点：

```text
GET  /agent/v1/health
GET  /agent/v1/state
GET  /agent/v1/nodes|edges|participants|stages|viewport|selection|document
POST /agent/v1/command
POST /agent/v1/assert
GET  /agent/v1/screenshot/canvas|window
```

## 10. Security

- 仅监听 127.0.0.1，绝不监听公网。
- 无 eval / arbitrary JS / arbitrary IPC / filesystem / shell。
- IPC 固定白名单 channel：`agent:bridge:request` / `agent:bridge:response` / `agent:capture-window`。
- 所有 HTTP 输入都经 runtime validation → typed DTO；malformed 请求返回结构化错误。

## 11. Future MCP adapter

```text
MCP Tool → Agent Interface(稳定协议)→ Store
```

禁止 MCP 直接触碰 Zustand。
