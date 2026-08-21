# NODE_SYSTEM.md — 节点系统设计

> 本文档描述 NodeFlow 的节点(Node)、端口(Port)、连线(Edge)、中间产物(Artifact)以及节点相关交互的完整设计。

## 1. 节点 (Node)

节点是流程中的动作单元,由 `FlowNode` 类型描述:

```ts
export type FlowNode = Node<FlowNodeData, 'flow'>;

interface FlowNodeData {
  label: string;          // 标题(画布内联编辑)
  description: string;    // 描述(多行内联编辑)
  actor: ActorType;       // 执行主体
  locked: boolean;        // 节点级锁定
  inputs: PortDef[];      // 输入端口
  outputs: PortDef[];     // 输出端口
  composite?: CompositeMeta; // 组合节点元数据(存在即组合节点)
}
```

### 1.1 执行主体 (Actor)

| 值 | 标签 | 图标 | 语义 |
| --- | --- | --- | --- |
| `human` | 人工 | 👤 | 由人执行 |
| `hybrid` | 人机协同 | 🤝 | 人与机器协同 |
| `machine` | 机器 | 🤖 | 由机器执行 |

轮换顺序:`human → hybrid → machine → human`(点击节点头部图标按钮)。

### 1.2 端口 (Port)

```ts
interface PortDef {
  id: string;   // uid('in' | 'out') 生成,如 in_abc123
  name: string; // 显示名,默认 输入N / 输出N
}
```

- 输入端口在左(`Handle type="target"`, `Position.Left`),输出端口在右(`Handle type="source"`, `Position.Right`)。
- 端口名称在画布内可直接单击编辑。
- 通过节点底部的 `+` 按钮快捷添加端口,数量不限。
- **端口光晕**:已连接端口显示绿色光晕,未连接显示桔色光晕(`nf-connected` / `nf-disconnected`),便于快速识别断连。

### 1.3 锁定机制

- **节点级锁定** (`data.locked`):锁定后禁止编辑标题/描述/端口/主体,但可拖动。
- **全局锁定 / 演示模式** (`allLocked`):一键锁定全部内容,禁止一切结构变更(新建/删除/连线/组合/编辑),且**不允许单独解锁**节点。所有操作按钮在 `allLocked` 下 `disabled`。

## 2. 连线 (Edge)

```ts
export type FlowEdge = Edge<FlowEdgeData, 'flow'>;

interface FlowEdgeData {
  label: string;              // 连线说明文字(单击编辑)
  artifact: Artifact | null;  // 中间产物
}
```

- 连线由 React Flow 交互创建(source 端口 → target 端口)。
- 自定义渲染 `FlowEdgeComponent`:**弧线**(smoothstep),中间产物以图标 + 文字标签展示在连线中点,标签可点击编辑。
- 连线遵循「画布连线置顶」策略,保证可读性。
- 连线删除:选中后按 Delete,或通过属性面板删除。

## 3. 中间产物 (Artifact)

```ts
interface Artifact {
  id: string;
  kind: ArtifactKind;   // 类型
  label: string;        // 名称
  description: string;  // 描述
}

type ArtifactKind = 'document' | 'image' | 'video' | 'audio' | 'code' | 'data' | 'other';
```

- 每根连线最多携带一个中间产物,表示该连接上流转的交付物。
- 在连线属性面板中创建 / 编辑 / 删除。

## 4. 节点内联编辑

节点标题、描述、端口名、连线标签均采用 **contentEditable 内联编辑**(`EditableText` 组件):

- 单击进入编辑(显示外框),失焦或回车(单行)提交。
- `Esc` 取消编辑并还原。
- 单行标题会压缩空白;多行描述保留换行,提交时清理行尾空格与多余空行。
- 组件使用不受控 contentEditable + `useEffect` 同步外部值,需注意编辑态与外部更新冲突的边界。

## 5. 节点交互总览

| 交互 | 行为 |
| --- | --- |
| 双击节点 | 阻止画布默认(创建节点),改为选中该节点 |
| 单击节点 | 选中并展示属性面板 |
| 点击主体图标按钮 | 轮换执行主体 |
| 点击锁定按钮 | 切换节点锁定(`allLocked` 下禁用) |
| 点击 `+` | 添加输入 / 输出端口 |
| 点击端口 | 连接(拖拽到另一端口) |
| 内联编辑 | 标题 / 描述 / 端口名 / 连线标签 |
| Delete | 删除选中节点 / 连线 |
| 拖动 | 移动节点位置(展开态组合节点除外) |

## 6. 组合节点在本系统中的位置

组合节点是节点系统的超集:普通节点 + 组合节点两种形态并存。组合节点复用普通节点的头部(标题/主体/锁定),端口由内部节点**自动聚合**(只读展示),详见 `COMPOUND_NODE_DESIGN.md`。
