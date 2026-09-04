# NodeFlow MCP Adapter

## 关系

```text
MCP is an adapter.
Agent Interface is the stable domain-facing boundary.
```

- MCP Server(`src/mcp/`)只是把 MCP Tool/参数翻译成 AgentRequest 信封;
- 它不直接触碰 Zustand / React / Electron IPC / DOM / GraphDocument;
- 所有操作经 Local Bridge(默认 `http://127.0.0.1:8787`)进入 NodeFlow Agent Core → Store Action。

## Transport

```text
MCP Client ↔(stdio)↔ MCP Server ↔(HTTP/JSON,127.0.0.1)↔ NodeFlow Agent Bridge
```

运行(需 NodeFlow Bridge 已开启):

```bash
NODEFLOW_AGENT_BRIDGE=1 NODEFLOW_AGENT_TEST_CMDS=1 bun run build && ... # Electron 带 Bridge
NODEFLOW_MCP_BRIDGE_URL=http://127.0.0.1:8787 NODEFLOW_MCP_TEST_FIXTURE=1 bun src/mcp/stdio.ts
```

## Tools(映射到 Agent Interface)

| MCP Tool | Agent API | 说明 |
|---|---|---|
| get_graph_state / get_document / get_nodes / get_edges / get_participants / get_stages / get_viewport / get_selection | getGraphState… | 只读 Observe |
| get_capabilities | (本地) | 返回 graph.read/write/assert/screenshot + test.fixture |
| create_node / update_node / delete_node | createNode… | |
| create_participant / update_participant / delete_participant | … | |
| create_stage / update_stage / delete_stage | … | |
| connect_edge / delete_edge | connectNodes / deleteEdge | 默认 out_1→in_1 |
| move_node | moveNode | 一次 position 原子历史 |
| assign_participant / assign_stage | assignParticipant / assignNodeStage | 语义不改几何 |
| arrange | runSmartArrange | 与工具栏一致 |
| undo / redo | undo / redo | 同 GUI history |
| get_annotations | getAnnotations | Phase D |
| create_gateway / change_gateway_type | createGateway / changeGatewayType | Phase D |
| attach_artifact / update_artifact / remove_artifact | attachArtifact / updateArtifact / removeArtifact | Phase D |
| create_annotation / update_annotation / delete_annotation / move_annotation | createAnnotation / updateAnnotation / deleteAnnotation / moveAnnotation | Phase D |
| assert(Composite/Gateway/Artifact/Annotation 类型) | assertCompositeContains / assertNodeParent / assertGatewayType / assertEdgeArtifact / assertAnnotationExists | Phase D |
| assert | assert | 语义+几何断言,结构化结果 |
| screenshot | getCanvasScreenshot / getWindowScreenshot | `target: canvas|window`,返回 image |
| reset / seed_fixture | reset / seedFixture | **test-only** |

## Resources

第一版观察统一经 Tools 提供(最小可行);后续可扩展为
`nodeflow://state|nodes|edges|participants|stages|viewport|selection|capabilities`。

## Capabilities

- 默认开启:graph.read / graph.write / graph.assert / graph.screenshot
- 默认关闭:test.fixture → `reset/seed_fixture` 不注册为 Tool;
- `NODEFLOW_MCP_TEST_FIXTURE=1` 才暴露 test-only Tools;同时 Agent Bridge 需
  `NODEFLOW_AGENT_TEST_CMDS=1`,否则调用返回 `CAPABILITY_NOT_ENABLED`。

## Screenshots

MCP 直接复用 Agent Interface 的 getCanvasScreenshot/getWindowScreenshot,
返回 MCP image content(base64 PNG)。不复制任何截图算法。

## Revision

- revision 唯一权威仍是 NodeFlow Store(Graph Mutation Authority)。
- MCP mutation → Agent command → store mutation → revision 前进;query 不前进;
- GUI/Undo/Redo 同样推进;MCP 不自维护 revision。

## Security

- 只连 localhost NodeFlow Bridge;不开放公网监听;
- 无 eval / shell / filesystem / arbitrary IPC;不绕过 Agent validation/capability。
