# NodeFlow — WorkBuddy Connector

让 WorkBuddy 安装后即可通过 MCP 操作正在运行的 NodeFlow。

## 目录

```text
workbuddy/nodeflow/
├── connector-meta.json   # Connector 元信息(type: mcp)
├── mcp.json              # MCP stdio 配置 → npx -y @cosmosdeng/nodeflow-mcp
├── icon.svg              # 市场图标
└── skills/
    └── nodeflow/
        └── SKILL.md      # AI 使用指引(Observe first / Arrange / Assert / Screenshot / Undo)
```

## Schema 依据

- Connector 规范:WorkBuddy 开放平台文档 https://open.workbuddy.cn/docs/connector
- Skill 规范:WorkBuddy 开放平台文档 https://open.workbuddy.cn/docs/skill
- connector-meta.json 使用官方 `name / name_zh / name_en / description / description_zh / description_en / source / type / version / examples_*` 字段;
- mcp.json 使用官方 `mcpServers.<name>` 的 stdio 形态(`command: npx`,`args: ["-y","@cosmosdeng/nodeflow-mcp"]`);
- SKILL.md frontmatter 使用官方必填 `description / description_zh / description_en / version / author`(附加 name / display_name 等可选字段)。

## 使用路径

1. 用户安装 NodeFlow next(自动启动 Agent Bridge,127.0.0.1:8787)。
2. WorkBuddy 安装本 Connector → 按 mcp.json 用 `npx -y @cosmosdeng/nodeflow-mcp` 启动 MCP Server。
3. 用户开始用自然语言操作 NodeFlow 画布。

## 打包 / 提交

- 本目录不包含 MCP Server 源码;MCP Server 是独立 npm 包 `@cosmosdeng/nodeflow-mcp`(仓库 `mcp-server/`)。
- Connector 目录在提交到 WorkBuddy 市场前按官方要求打包为 zip(不含 node_modules / dist)。
