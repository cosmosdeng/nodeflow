# NodeFlow MCP 接入(Agent Interface / MCP Server / Agent Bridge / Connector)

## 0. 四个概念区分

| 概念 | 是什么 | 位置 / 形态 | 职责 |
|---|---|---|---|
| **Agent Interface** | NodeFlow 面向 AI 的稳定 domain-facing 协议(Query / Command / Assert / Screenshot / Capabilities) | `src/agent/`(renderer 内 Agent Core) | 唯一被信任的边界:稳定 DTO、一次 mutation=一条 history=一次 revision |
| **MCP Server** | 把 MCP Tool/参数翻译成 AgentRequest 的 adapter | npm 包 `@cosmosdeng/nodeflow-mcp`(dist);源码参考 `src/mcp/` | 只做映射与结构校验,不触碰 Zustand / React / Electron IPC / DOM |
| **Agent Bridge** | NodeFlow 暴露的 localhost HTTP 桥 | Electron 主进程 `electron/agentBridge.ts`,默认 `127.0.0.1:8787` | 本机 HTTP/JSON ↔ 白名单 IPC ↔ renderer Agent Core |
| **WorkBuddy Connector** | 让 WorkBuddy 一键使用 NodeFlow 的发布包 | `workbuddy/nodeflow/`(connector-meta.json / mcp.json / SKILL.md) | 指向 `npx -y @cosmosdeng/nodeflow-mcp`,无需用户手动配置 |

关系:

```text
MCP is an adapter.
Agent Interface is the stable domain-facing boundary.
Agent Bridge is the localhost HTTP transport exposed by NodeFlow.
```

- MCP Server 不直接访问 Zustand / React / DOM / Electron renderer internals / arbitrary IPC / filesystem / shell / eval;
- 所有操作经 `http://127.0.0.1:8787` 进入 NodeFlow Agent Core → Store Action。

## 1. Transport

```text
MCP Client ↔(stdio)↔ @cosmosdeng/nodeflow-mcp ↔(HTTP/JSON,127.0.0.1:8787)↔ NodeFlow Agent Bridge
```

运行:

```bash
# 1) 启动 NodeFlow next —— Agent Bridge 会自动启动(默认 127.0.0.1:8787)
#    如不需要,可用 NODEFLOW_AGENT_BRIDGE=0 关闭
bun run build && bun run start

# 2) 启动 MCP Server(独立 npm 包;普通用户直接由 WorkBuddy Connector 代劳)
#    当前为 prerelease,使用 @next dist-tag:
npx -y @cosmosdeng/nodeflow-mcp@next
#    仓库内开发也可用本地构建路径:
/usr/local/bin/node mcp-server/dist/cli.js     # node 路径以 `which node` 为准
```

Bridge 默认地址为 `http://127.0.0.1:8787`,可通过 `NODEFLOW_MCP_BRIDGE_URL` 覆盖。

> **发布状态**:`@cosmosdeng/nodeflow-mcp` 已发布为 npm prerelease(当前 `0.4.0-next.2`,dist-tag `next`)。
> 检查可用版本/标签:
> `npm view @cosmosdeng/nodeflow-mcp dist-tags`。稳定版发布后,不带 tag 的 `npx -y @cosmosdeng/nodeflow-mcp` 才作为通用方式。

> 说明:本仓库 `src/mcp/stdio.ts` 是 MCP 适配器的仓库内开发入口;对外发布的是独立 npm 包
> `@cosmosdeng/nodeflow-mcp`(构建自仓库同一份 `src/mcp/*` 单一源)。

> 各 AI Agent 配置见 [MCP Client Setup Guide](mcp-clients.md)(WorkBuddy / CodeBuddy / OpenAI Codex /
> Cursor / Claude Code / OpenCode)。

## 2. Tools(映射到 Agent Interface)

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
| screenshot | getCanvasScreenshot / getWindowScreenshot | `target: canvas\|window`,返回 image |
| reset / seed_fixture | reset / seedFixture | **test-only** |

## 3. Resources

第一版观察统一经 Tools 提供(最小可行);后续可扩展为
`nodeflow://state|nodes|edges|participants|stages|viewport|selection|capabilities`。

## 4. Capabilities

- 默认开启:graph.read / graph.write / graph.assert / graph.screenshot
- 默认关闭:test.fixture → `reset/seed_fixture` 不注册为 Tool;
- `NODEFLOW_MCP_TEST_FIXTURE=1` 才暴露 test-only Tools;同时 NodeFlow 侧需
  `NODEFLOW_AGENT_TEST_CMDS=1`,否则调用返回 `CAPABILITY_NOT_ENABLED`。
- **WorkBuddy Connector 不设置上述变量**,因此普通用户始终无法使用 reset/seed_fixture。

## 5. Screenshots

MCP 直接复用 Agent Interface 的 getCanvasScreenshot/getWindowScreenshot,
返回 MCP image content(base64 PNG)。不复制任何截图算法。

## 6. Revision

- revision 唯一权威仍是 NodeFlow Store(Graph Mutation Authority)。
- MCP mutation → Agent command → store mutation → revision 前进;query 不前进;
- GUI/Undo/Redo 同样推进;MCP 不自维护 revision。

## 7. Bridge 连接失败

NodeFlow 未运行时,MCP tool 返回清晰错误:

```text
NodeFlow is not running or Agent Bridge is unavailable at http://127.0.0.1:8787. Please start NodeFlow.
```

不会自动启动 Electron / 下载 NodeFlow / 开放公网端口。

## 8. Security

- 只连 localhost NodeFlow Bridge(127.0.0.1:8787);不开放公网监听;
- 无 eval / shell / filesystem / arbitrary IPC;不绕过 Agent validation/capability;
- MCP stdio stdout 只输出 MCP protocol,日志走 stderr。

## 9. WorkBuddy Connector

```text
WorkBuddy
   ↓ (安装 Connector)
workbuddy/nodeflow/(connector-meta.json + mcp.json + SKILL.md)
   ↓ (mcp.json)
npx -y @cosmosdeng/nodeflow-mcp
   ↓ (stdio)
MCP Server(npm 包)
   ↓ (HTTP/JSON 127.0.0.1:8787)
NodeFlow Agent Bridge
   ↓
NodeFlow next
```

用户只需:安装 NodeFlow next → 安装 Connector → 启动 NodeFlow → 用 WorkBuddy 操作。

> Connector 的 `mcp.json` 按 npm 分发方式写为 `npx -y @cosmosdeng/nodeflow-mcp@next`
> (当前 prerelease 需带 `@next`;稳定版发布后去掉)。

## 10. OpenCode(本地 MCP)

NodeFlow MCP can be configured as a local MCP server in OpenCode's `opencode.json`
(或 `opencode.jsonc`),按当前 OpenCode 官方 schema(`mcp` 顶层 map,`command` 为数组):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "nodeflow": {
      "type": "local",
      "command": ["npx", "-y", "@cosmosdeng/nodeflow-mcp@next"],
      "enabled": true
    }
  }
}
```

前提:NodeFlow **next** 正在本机运行,Agent Bridge 位于 `http://127.0.0.1:8787`。

## 11. 环境变量边界

| 变量 | 默认 | 说明 |
|---|---|---|
| `NODEFLOW_MCP_BRIDGE_URL` | `http://127.0.0.1:8787` | MCP Server 连接的 Bridge 地址;高级用户可按需覆盖 |
| `NODEFLOW_MCP_TEST_FIXTURE` | 未设置(关) | 设为 `1` 才在 MCP 注册 `reset/seed_fixture`;普通用户不要开 |
| `NODEFLOW_AGENT_BRIDGE` | 未设置(自动启动) | NodeFlow next 默认自动启动 Bridge;`0` 可关闭(Desktop 侧) |
| `NODEFLOW_AGENT_TEST_CMDS` | 未设置(关) | 开启 test-only command 能力;普通使用**不要**设置 |

正常用户无需配置任何环境变量;WorkBuddy / OpenCode 通过默认 `127.0.0.1:8787` 即可连接。
