# @cosmosdeng/nodeflow-mcp

NodeFlow 的独立 MCP(stdio)适配器。它让 AI Agent(WorkBuddy / Claude / 任意 MCP Client)通过 MCP 工具操作**正在运行的 NodeFlow**。

```text
WorkBuddy / MCP Client
   │  MCP stdio
   ▼
@cosmosdeng/nodeflow-mcp      ← 本包(仅 adapter)
   │  HTTP/JSON(仅本机)
   ▼
NodeFlow Agent Bridge          ← NodeFlow next 自动启动于 127.0.0.1:8787
   ▼
NodeFlow(Electron / React / Store)
```

本包**不包含** NodeFlow 本体:

- 不启动 Electron / NodeFlow UI;
- 不读取 NodeFlow 项目文件;
- 不访问 Zustand / React DOM / Electron IPC;
- 不执行任意 shell / eval / 任意本地文件操作。

它只是一个把 MCP Tool 调用翻译成 NodeFlow Agent Bridge 请求的 adapter。

## 使用

前提:NodeFlow **next** 已运行(会自动启动 Agent Bridge)。

```bash
# 方式一:本仓库开发验证(需已构建)
node mcp-server/dist/cli.js

# 方式二:CLI bin(安装到全局/本地后)
nodeflow-mcp

# 方式三:发布后的任意机器
npx -y @cosmosdeng/nodeflow-mcp
```

默认连接 `http://127.0.0.1:8787`;可用环境变量覆盖:

```bash
NODEFLOW_MCP_BRIDGE_URL=http://127.0.0.1:8787 nodeflow-mcp
```

### stdio 规则

- **stdout 只输出 MCP protocol**;所有日志写 stderr,不会污染协议通道。
- Bridge 不可达时,tool 返回清晰错误(`NodeFlow is not running or Agent Bridge is unavailable at ...`),不会静默崩溃。

### Test Fixture

`reset` / `seed_fixture` 属于 test-only tools,**默认关闭**。仅当同时满足:

```bash
NODEFLOW_MCP_TEST_FIXTURE=1   # 本包:注册 test-only tools
```

且 NodeFlow 侧开启 `NODEFLOW_AGENT_TEST_CMDS=1` 时,它们才会生效。

## MCP Client 配置

前提:**NodeFlow next 正在运行**,其 Agent Bridge 在 `127.0.0.1:8787`(next 默认自动启动;`NODEFLOW_AGENT_BRIDGE=0` 可关闭)。本包是 MCP Server(连接方),不负责启动 NodeFlow。

### WorkBuddy

推荐在 WorkBuddy 安装 NodeFlow Connector(仓库 `workbuddy/nodeflow/`),其 `mcp.json` 指向本包:

```json
{
  "mcpServers": {
    "nodeflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cosmosdeng/nodeflow-mcp"]
    }
  }
}
```

### OpenCode

在 `opencode.json`(或 `opencode.jsonc`)中按 OpenCode 官方 schema 配置为 local MCP server:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "nodeflow": {
      "type": "local",
      "command": ["npx", "-y", "@cosmosdeng/nodeflow-mcp"],
      "enabled": true
    }
  }
}
```

> 通用 stdio 原则:任意 MCP Client 都可用 `npx -y @cosmosdeng/nodeflow-mcp`
> (或本机已构建的 `node .../mcp-server/dist/cli.js`)作为 stdio 命令启动本包。

## 开发

```bash
# 从仓库单一源构建 dist(cli.js / index.js / index.d.ts)
cd mcp-server && npm run build

# 运行独立包测试(node --test)
npm test
```

构建通过 esbuild 把仓库内 `src/mcp/*` 与 `src/agent/types` 打包进 `dist/`,外部依赖仅 `@modelcontextprotocol/sdk` 与 `zod`;不会把 NodeFlow 的 Electron / React 代码打进来。

## License

MIT
