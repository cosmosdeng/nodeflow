# NodeFlow Figma 设计输入规则（最终版）

> Figma 是人工设计和表达想法的工具。
> 用户不需要在 Figma 中制作精确、高保真、production-ready 的设计稿。

## 核心原则

- 不要要求用户提供精确设计。
- 不要要求用户遵循固定的 Figma 设计规范。
- 用户可以在 Figma 中：随手画草图、调整布局、修改比例、尝试颜色、调整组件、画出大致结构、表达视觉方向、制作半成品、制作完整界面。
- 设计精度完全由用户根据时间和精力决定。

## Figma 的意义

Figma 中的设计主要表达：

> "我希望 NodeFlow 往这个方向变化。"

而不是：

> "NodeFlow 必须严格复制 Figma 中的每一个像素。"

因此：

```text
Figma = Design Intent / Visual Reference
```

而不是：

```text
Figma = 严格 UI Specification
```

## 默认输入方式：截图

NodeFlow 设计实验默认使用：

```text
Figma → Screenshot → CodeBuddy
```

用户不需要为了 CodeBuddy 而制作复杂的 Figma 文件结构。

Figma 文件可以提供，但不是必需的。CodeBuddy 不得要求用户为了实现 UI 而额外整理 Figma 文件。

## 不得把 Figma 中的数值自动当成规格

例如 Figma 中出现：

```text
Panel width = 317px
Gap = 13px
Node width = 183px
```

默认不得解释为实现约束（"必须 317px"等）。这些数值可能只是绘图过程中自然产生的结果。

除非用户明确说"这个尺寸很重要，请严格按照这个尺寸实现"，否则应理解为大致视觉比例和空间关系。

## CodeBuddy 的主要任务

CodeBuddy 不负责判断 "Figma 应该如何精确转换成 React"。

CodeBuddy 的任务是理解：

1. **用户改变了什么**（例如：Properties Panel 更宽 / Canvas 更突出 / Outliner 更紧凑 / Node 更简洁 / Toolbar 更轻量）。
2. **这些变化可能表达什么设计意图**（例如：Properties Panel 变宽，可能意味着用户希望复杂节点拥有更多可直接编辑的属性空间）。
3. **哪些变化应该进入 NodeFlow**。应区分视觉变化、布局变化、交互变化、产品逻辑变化、数据模型变化。不能因为一个视觉变化就自行改变 NodeFlow 的 domain semantics。

## 必须先分析，再实现

收到 Figma 截图后：

### 第一阶段：只分析

```text
Observation → Interpretation → Proposed Design Decisions
```

不要立即修改代码。

- **Observation**：只描述看到的变化（"The Properties Panel is visually wider."）。
- **Interpretation**：解释可能的设计意图（"may indicate that complex node properties should be easier to inspect and edit."）。不要把推测当成事实。
- **Proposed Design Decisions**：形成 Design Decision / Reason / Confidence，然后 `WAIT FOR USER APPROVAL`。

## 实现

用户确认后才进入：

```text
next → experiment/<specific-experiment> → NodeFlow implementation
```

不再经过任何设计软件。特别是：

- 不要 `Figma → Penpot → NodeFlow`。
- 不要 `Figma → CodeBuddy → 重新在 Penpot 中绘制 → NodeFlow`。
- CodeBuddy 不负责在 Penpot 或其他设计工具中重新绘制 Figma。

## Figma 与 NodeFlow 的关系

```text
Figma visual element ≠ NodeFlow domain object
Figma group ≠ scene graph parent
Figma position ≠ node.position
```

Figma 只提供视觉设计证据。现有 NodeFlow 产品语义优先。

## 视觉验证

实现后做 `Figma screenshot ↕ NodeFlow screenshot` 视觉比较，重点比较：整体构图、空间比例、视觉层级、密度、色彩、typography、component appearance、panel relationship、alignment。

不追求机械的 pixel-perfect reproduction。如果 Figma 只是草图，应实现其设计意图，而不是复制草图中的偶然几何误差。

## 用户拥有最终设计权

如果存在多个合理解释，不要自行选择。列出 `Interpretation A / Interpretation B`，并等待用户决定。

## 最终工作流

```text
Human
  ↓
Figma
  ↓
Screenshot
  ↓
CodeBuddy
  ↓
Observation
  ↓
Interpretation
  ↓
Proposed Design Decisions
  ↓
User Approval
  ↓
experiment/<name>
  ↓
NodeFlow
  ↓
Visual Verification
  ↓
Iteration
```

## 角色

- Human = Design Authority
- Figma = Visual Thinking / Design Reference
- Screenshot = 默认 Design Evidence
- CodeBuddy = Design Interpreter + Implementation Agent
- NodeFlow = Product Implementation
- Git = Safety Boundary

不要求用户制作精确设计，不要求提供 Figma 文件，不要求维护 Design System，不要求用户在 Figma 中完成所有 UI 细节。

用户只需要：在自己愿意投入的时间和精力范围内，用 Figma 把想法画出来。剩下的工作由 CodeBuddy 在 NodeFlow 的实验分支中完成。
