# NodeFlow Agent Architecture Development Status

## 1. Current Baseline

```text
628b77a feat(agent): complete agent interface and MCP domain integration
```

This commit is the current Agent Architecture baseline.

当前状态：

```text
Pushed: NO
Tagged: NO
Released: NO
Working tree: clean
```

---

# 2. Completed Architecture

## A-001 — Graph Mutation Authority / agentRevision

- `agentRevision` 已从分散的 Agent mutation bump 统一到 Graph Mutation Authority
- Graph observable fingerprint 发生变化时 revision 增加
- GUI mutation / Agent mutation / Undo / Redo 均进入统一 revision 机制
- revision 是 runtime-only
- 不进入 persistence
- 不进入 history snapshot

---

## A-002 — Test Fixture Capability Boundary

- `test.fixture` 是显式 capability
- 默认关闭
- 需要明确环境能力才能使用
- main process 是 capability authority
- IPC 到 renderer 后再次检查
- Agent executor 不能绕过 capability
- 普通 Agent API 与 test fixture API 分离

---

## Phase C — MCP Adapter

架构：

```text
AI Agent
   ↓
MCP
   ↓
NodeFlow MCP Adapter
   ↓
Local HTTP Test Bridge
   ↓
Electron IPC
   ↓
Renderer Agent Core
   ↓
Graph Store / Domain
```

关键原则：

```text
MCP = adapter
Agent Core = stable interface
Store / Domain = mutation authority
```

MCP 不直接访问：

```text
Zustand
React
DOM
Electron renderer internals
arbitrary IPC
filesystem
shell
eval
```

---

## S-001 — Create Entity ID

create 系列已经返回：

```text
entityId
revision
success
```

包括：

```text
createNode
createParticipant
createStage
connectNodes
```

MCP mutation result 已扁平化为稳定结构：

```text
{
  success,
  revision,
  entityId
}
```

---

# 3. Phase D — Agent Domain Expansion

当前 Domain Matrix：

| Domain | Observe | Create | Modify | Delete | Assert |
|---|---|---|---|---|---|
| Node | YES | YES | YES | YES | YES |
| Edge | YES | YES | limited | YES | YES |
| Participant | YES | YES | YES | YES | YES |
| Stage | YES | YES | YES | YES | YES |
| Composite | YES | NO | NO | NO | YES |
| Gateway | YES | YES | YES | YES | YES |
| Artifact | YES | YES | YES | YES | YES |
| Annotation | YES | YES | YES | YES | YES |
| Viewport | YES | — | — | — | observation |

### Composite

目前只有：

```text
Observe
Assert
```

原因：

当前 Store 没有适合 Agent 使用的 ID-based：

```text
create composite
add child
remove child
delete composite
```

现有 `groupSelected` 依赖 React Flow selection。

因此：

> 不伪造 Composite Agent capability。

这是一个明确的 architecture observation，而不是当前必须修复的问题。

---

# 4. Verified End-to-End Capability

已经通过真实 Electron + MCP E2E：

```text
create_gateway
→ change_gateway_type
→ connect_edge
→ attach_artifact
→ create_annotation
→ update_annotation
→ arrange
→ get_graph_state
→ assertions
→ screenshot
```

当前验证：

```text
312/312 tests PASS
TypeScript PASS
Build PASS
Real Electron + MCP E2E PASS
```

---

# 5. Current Agent Interaction Model

NodeFlow 当前已经形成：

```text
Observe
→ Understand
→ Act
→ Observe
→ Assert
→ Screenshot
→ Continue
```

三个观察层：

```text
Semantic State
+
Geometry
+
Visual Canvas
```

### Semantic

AI 可以观察：

```text
nodes
edges
participants
stages
gateway
artifact
annotation
composite relations
viewport
selection
graph state
```

### Geometry

已经支持：

```text
node position
containment
overlap
participant/stage band relationships
```

### Visual

已经支持：

```text
canvas screenshot
window screenshot
```

---

# 6. Important Architectural Decisions

## MCP 不是核心 Domain API

MCP 是 adapter。

未来可以存在：

```text
MCP
OpenAPI
Python
Playwright
CI
Other Agent Clients
```

全部使用同一个 Agent Interface / Domain capability。

---

## AI 不应该以鼠标模拟作为主要操作方式

首选：

```text
semantic command
```

GUI 操作主要用于：

```text
testing
visual verification
interaction scenarios
```

---

## Human 与 AI 是两个 Client

目标架构：

```text
             ┌── Human UI
             │
NodeFlow Domain / Graph State
             │
             └── AI Agent
```

两者最终都作用于同一个 Domain State。

---

# 7. Current Known Observations

不要把 observations 写成已经解决的问题。

### D-001 — Composite Agent Mutation Gap

Priority：

```text
MEDIUM
```

当前没有适合 Agent 的 ID-based Composite mutation API。

后续如果进入 Composite Domain Enhancement，需要先设计：

```text
createComposite
addChild
removeChild
deleteComposite
```

以及：

```text
parentCompositeId
childIds
```

之间的事务语义。

不要直接复用 GUI selection-based API。

---

### D-002 — Edge Label / Description Mutation

Priority：

```text
LOW
```

目前 Edge 的 observe/create/delete 已支持，但 label / description mutation 尚未完整暴露。

后续根据真实 Agent workflow 决定。

---

### D-003 — Gateway Assertion Parameter Naming

Agent assertion envelope 已经占用了：

```text
type
```

因此 gateway expected type 使用：

```text
expectedType
```

避免 schema 参数冲突。

这是已解决并文档化的设计细节。

---

# 8. Next Phase

下一阶段暂定：

# Phase E — Real Agent Workflow Validation + Agent Interface Gap Analysis

非常重要：

> 下一阶段不是立即继续增加 API。

首先让真实 AI Agent 通过 MCP 操作运行中的 NodeFlow。

目标：

```text
Observe
→ Create
→ Connect
→ Assign
→ Arrange
→ Observe
→ Assert
→ Screenshot
```

至少设计 3–5 个真实 workflow。

例如：

### Workflow A

从空图创建：

```text
Participants
Stages
Nodes
Edges
```

然后 Arrange。

---

### Workflow B

读取已有流程并进行修改：

```text
Observe
→ identify target
→ modify
→ verify
```

---

### Workflow C

包含：

```text
Gateway
Artifact
Annotation
```

的跨域流程。

---

### Workflow D

故意制造一个错误状态，然后让 Agent：

```text
Observe
→ Diagnose
→ Repair
→ Assert
```

---

# 9. Phase E 的核心原则

必须避免：

```text
猜测 AI 需要什么 API
→ 实现 API
→ 再发现设计不合理
```

改成：

```text
真实 Agent Workflow
        ↓
发现表达不了的操作
        ↓
Domain Gap
        ↓
设计最小 capability
        ↓
测试
        ↓
Agent API
        ↓
MCP Adapter
```

也就是说：

> **真实 Agent workflow 驱动 API 演进。**

---

# 10. Do Not Start Yet

Checkpoint 明确禁止下一次直接开始：

```text
Composite Domain Enhancement
```

除非 Phase E 的真实 Agent workflow 证明 Composite mutation 是实际阻塞点。

也不要提前开始：

```text
OpenAPI
Remote MCP
Event Stream
复杂 Agent Planning
Agent Memory
新的 UI
Release
```

先验证现有 Agent Interface 是否真的可用。

---

# 11. Resume Instruction

未来 CodeBuddy 开始新的 NodeFlow Agent Architecture 工作时：

第一步读取：

```text
docs/architecture/agent-development-status.md
```

然后读取：

```text
git show 628b77a
```

确认当前 baseline。

之后：

1. 不重复实现 A-001/A-002
2. 不重复实现 Phase C MCP
3. 不重复实现 S-001
4. 不重复实现 Phase D
5. 从 Phase E Real Agent Workflow Validation 开始

---

# 12. Checkpoint Metadata

```text
Checkpoint:
NodeFlow Agent Architecture

Baseline:
628b77a

Status:
READY FOR PHASE E

Next:
Real Agent Workflow Validation + Agent Interface Gap Analysis

Push:
NO

Release:
NO
```
