# NodeFlow MCP — AI Agent Client Setup Guide

> NodeFlow exposes a stable Agent Interface and an MCP(stdio)adapter, allowing AI agents
> to inspect and operate NodeFlow through its **local** Agent Bridge.

This guide explains how to connect common AI / coding agents to NodeFlow. All configurations
here follow each product's **current official documentation**(checked on 2026-09-08).
If a product updates its schema, prefer its official docs over this guide.

## Architecture

```text
AI Agent
   │
   │ MCP / stdio
   ▼
@cosmosdeng/nodeflow-mcp     ← MCP Server(npm package)
   │
   │ HTTP / JSON(仅本机)
   ▼
NodeFlow Agent Bridge        ← NodeFlow next 自动启动于 127.0.0.1:8787
   │
   ▼
NodeFlow Electron
   │
   ▼
NodeFlow Store / Canvas
```

Key facts:

- The npm package `@cosmosdeng/nodeflow-mcp` **is** the MCP Server.
- NodeFlow Electron provides the **Agent Bridge**; the MCP Server is **not** the NodeFlow GUI.
- The AI Agent calls NodeFlow **through** MCP.
- Default Bridge: `http://127.0.0.1:8787`(localhost-only).
- NodeFlow **next**(with Agent Bridge support)starts the Bridge automatically.
- If the Bridge is unavailable, MCP cannot operate NodeFlow(returns a clear `BRIDGE_UNAVAILABLE` error).
- test fixture / reset / seed capabilities are off by default.

## npm package

Current prerelease(dist-tag `next`):

```bash
npx -y @cosmosdeng/nodeflow-mcp@next
```

Check available dist-tags / versions:

```bash
npm view @cosmosdeng/nodeflow-mcp dist-tags
```

- Current prerelease:`0.4.0-next.2`(dist-tag `next`)。
- Once a stable release is published, prefer the untagged form:

```bash
npx -y @cosmosdeng/nodeflow-mcp
```

Do **not** assume the untagged form is the current prerelease.

> 前提:所有客户端都需要 NodeFlow **next** 正在运行且 Agent Bridge 可用(见上文 Architecture)。
> 下面的配置假设 NodeFlow 已启动。

---

## WorkBuddy

Official docs:<https://open.workbuddy.cn/docs/connector>

WorkBuddy uses **Connector** packages. The NodeFlow Connector in this repository lives at
`workbuddy/nodeflow/`(connector-meta.json / mcp.json / icon.svg / SKILL.md)。安装 Connector 后
WorkBuddy 会按 Connector 的 `mcp.json` 启动 NodeFlow MCP Server。

- `mcp.json` 使用官方 stdio 形态,指向 npm package:

```json
{
  "mcpServers": {
    "nodeflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cosmosdeng/nodeflow-mcp@next"]
    }
  }
}
```

- 如果 WorkBuddy Marketplace 尚未收录 NodeFlow Connector,需要自行安装本地/自建 Connector;
  GitHub 仓库存在 ≠ Marketplace 一键安装。
- 前提:NodeFlow Desktop 正在运行,Agent Bridge(`127.0.0.1:8787`)可用。
- 若手动把上述 JSON 作为自定义 MCP 使用,同样有效(stdio 通用)。

验证:在 WorkBuddy 的 MCP / 连接器列表应看到 `nodeflow ✓ Connected`,并能列出其 tools。

---

## CodeBuddy

Official docs:<https://www.codebuddy.cn/docs/cli/mcp>

CodeBuddy CLI supports MCP servers. Add nodeflow via CLI(user scope):

```bash
codebuddy mcp add --scope user nodeflow -- npx -y @cosmosdeng/nodeflow-mcp@next
```

Or use `add-json`:

```bash
codebuddy mcp add-json --scope user nodeflow \
  '{"type":"stdio","command":"npx","args":["-y","@cosmosdeng/nodeflow-mcp@next"]}'
```

Verify:

```bash
codebuddy mcp list        # → nodeflow ✓ Connected
codebuddy mcp get nodeflow
```

Config files(CodeBuddy official):

- user scope:`~/.codebuddy/.mcp.json`
- project scope:`<project-root>/.mcp.json`

Permissions:CodeBuddy tool names look like `mcp__nodeflow__get_graph_state`(double underscore)。
Non-interactive mode may need `--settings '{"enableAllProjectMcpServers": true}'` for project-scope MCP.

Minimal read-only test:

```text
连接 NodeFlow MCP。读取当前 NodeFlow 图状态。不要修改任何数据。
```

---

## OpenAI Codex

Official docs:<https://developers.openai.com/codex/extend/mcp>

Codex MCP config lives in `~/.codex/config.toml`(`[mcp_servers.<name>]`),or use the CLI.

CLI:

```bash
codex mcp add nodeflow -- npx -y @cosmosdeng/nodeflow-mcp@next
```

Or `config.toml`:

```toml
[mcp_servers.nodeflow]
command = "npx"
args = ["-y", "@cosmosdeng/nodeflow-mcp@next"]
```

Verify:

```bash
codex mcp list
```

Project-level config can be placed in `.codex/config.toml`(trusted projects)。Note that Codex
config syntax is TOML,not JSON。

---

## Cursor

Official docs:<https://cursor.com/docs/context/mcp>

Cursor uses a JSON config with `mcpServers`。

Project-level(commit to repo):

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nodeflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cosmosdeng/nodeflow-mcp@next"]
    }
  }
}
```

Global-level:`~/.cursor/mcp.json`(same shape)。

After saving, the server appears under **Settings → MCP / Custom**; toggle it on. If tools do not
show up, restart Cursor(or reload the MCP list)。Check **MCP Logs** in the Output panel for errors。

---

## Claude Code

Official docs:<https://code.claude.com/docs/en/mcp>

Claude Code supports `claude mcp add`(CLI)or a project-level `.mcp.json`。

CLI(local/user or project scope):

```bash
claude mcp add --transport stdio nodeflow -- npx -y @cosmosdeng/nodeflow-mcp@next
```

Options:`--scope user`(all projects)or `--scope project`(writes `.mcp.json`)。

Project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "nodeflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cosmosdeng/nodeflow-mcp@next"]
    }
  }
}
```

Verify:

```bash
claude mcp list        # → nodeflow ✔ Connected
claude mcp get nodeflow
```

In a session, use `/mcp` to see server status。

> 不要把 Claude Desktop 的旧配置格式(connectors JSON)当作 Claude Code 配置;上面是 Claude Code 官方格式。

---

## OpenCode

Official docs:<https://opencode.ai/docs/mcp-servers/>

OpenCode(v2)config uses a top-level `mcp` map in `opencode.json` / `opencode.jsonc`;
`command` is an **array**。

`opencode.json`:

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

Place it in the project root(or global OpenCode config)。Verify with OpenCode's MCP listing
(`opencode mcp` / config UI)that `nodeflow` is connected。

---

## Other MCP-compatible agents

Agents not listed above with reliable MCP support may still work, provided you follow their
**current official** MCP docs. General guidance:

- Prefer the CLI/`npx` stdio form:

```text
npx -y @cosmosdeng/nodeflow-mcp@next
```

- Any stdio-based MCP config must specify `command: npx` and
  `args: ["-y", "@cosmosdeng/nodeflow-mcp@next"]`(or your local build path when developing).
- We only document clients whose official format we could verify here; if a client is not listed,
  consult its official MCP documentation rather than third-party tutorials.

> 本仓库未对 Gemini CLI / Cline / Roo Code / Windsurf / Goose / Copilot-VS-Code 逐一给出配置,
> 因为它们各自的官方 MCP schema 未在本指南编写时逐项核对;请以对应产品官方文档为准。

---

## Smoke tests(per client)

### Read-only test

```text
使用 NodeFlow MCP。

先读取当前图状态,不要修改任何数据。
告诉我:
1. 当前节点数量
2. 当前连线数量
3. Participant 数量
4. Stage 数量

不要创建、删除、移动或修改任何对象。
```

### Write test(creates + cleans up a temporary node)

```text
使用 NodeFlow MCP 创建一个测试节点,名称为"MCP Test"。
读取确认创建成功,然后删除这个节点。
最后再次读取图状态。

除这个测试节点外,不得修改其他对象。
```

### Screenshot test(if the client supports images)

```text
读取当前 NodeFlow 图并获取截图。
确认画布中没有明显节点重叠。
```

> 不要为了测试破坏用户现有业务图;写测试务必使用临时节点并在结束后清理。

---

## Security

- Default Bridge is localhost-only:`127.0.0.1:8787`。不要把它暴露到公网。
- test fixture capability is off by default。普通用户不要开启:

```text
NODEFLOW_AGENT_TEST_CMDS
NODEFLOW_MCP_TEST_FIXTURE
```

- MCP does not execute arbitrary shell / eval;MCP clients never access
  Zustand / React / Electron internals directly.
- MCP is an adapter of the NodeFlow Agent Interface(see [mcp.md](mcp.md))。

---

## Troubleshooting

### Bridge unavailable

Health check(actual endpoint from code):

```bash
curl http://127.0.0.1:8787/agent/v1/health
```

Expected:`{"status":"ok","agentBridge":true}`。If NodeFlow is not running or Bridge is off,
start NodeFlow **next**(it starts the Bridge automatically;disable with `NODEFLOW_AGENT_BRIDGE=0`)。

### npm prerelease not found

```bash
npm view @cosmosdeng/nodeflow-mcp dist-tags
```

Current prerelease install:

```bash
npx -y @cosmosdeng/nodeflow-mcp@next
```

### Agent cannot see MCP / tools listed but calls fail

Check, in order:

1. MCP config(command / args / scope)in the client;
2. client server logs / MCP logs;
3. NodeFlow is running and Bridge is up(`curl .../agent/v1/health`);
4. restart the client after adding a server when required.

### screenshot fails

Screenshot depends on the NodeFlow renderer / BrowserWindow state. Ensure the NodeFlow window is
open(and on macOS,focused)before requesting a screenshot; retry if the first call times out.

---

## Version policy

```text
Current prerelease:  @cosmosdeng/nodeflow-mcp@next (0.4.0-next.2)
Future stable:       @cosmosdeng/nodeflow-mcp(untagged)
```

If the actual npm version changes, use the output of `npm view @cosmosdeng/nodeflow-mcp dist-tags`.

## Related docs

- [MCP documentation](mcp.md)
- [Agent Interface](agent-interface.md)
- [Agent architecture development status](architecture/agent-development-status.md)
- NodeFlow repository:<https://github.com/cosmosdeng/nodeflow>
