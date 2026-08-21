# AI Context

本文档为 AI 协作维护本项目提供稳定的上下文基线,内容应与代码保持一致,修改代码时需同步更新。

## 项目目标

NodeFlow 是一个跨平台(Windows / macOS / Linux)的**节点式流程绘图与编排工具**,基于 Electron + React + React Flow 构建,核心目标:

1. 提供无限画布,支持节点、连线、中间产物的自由编辑。
2. 支持**组合节点(Composite Node)**:把多个节点聚合为单个节点,并在展开 / 塌缩之间无损切换。
3. 提供节点级与全局级的编辑保护(节点锁定 / 演示模式全锁)。
4. 数据本地持久化(自动保存),支持 JSON 导入 / 导出与完整撤销 / 重做历史。

## 核心概念定义

| 概念 | 定义 |
| --- | --- |
| 节点 (Node) | 流程中的一个动作单元,拥有若干输入/输出端口,标记执行主体。 |
| 执行主体 (Actor) | 节点标签:`human` 人工(👤)、`machine` 机器(🤖)、`hybrid` 人机协同(🤝)。 |
| 端口 (Port) | 节点的输入/输出端点,由 `{ id, name }` 描述,用于连线吸附。 |
| 连线 (Edge) | 连接两个端口的流,可携带说明文字与中间产物。 |
| 中间产物 (Artifact) | 挂在连线上的对象,类型:文档/图像/视频/音频/代码/数据/其他。 |
| 组合节点 (Composite Node) | 携带 `composite` 元数据的节点,聚合多个子节点,支持展开/塌缩。 |
| 聚合端口 | 由内部节点未连接的端口自动聚合而成,以 `cid:` 编码引用;展开 / 塌缩均渲染,可直接对外连线。 |
| 内部画布 (Tab / Popup) | 以标签页或独立窗口打开组合节点的子节点画布。 |
| 锁定 | 节点级 `locked` 禁止编辑该节点;全局 `allLocked`(演示模式)禁止一切结构变更。 |

## Node / Edge 数据结构

### Node

```ts
export type FlowNode = Node<FlowNodeData, 'flow'>;

interface FlowNodeData {
  label: string;          // 标题
  description: string;    // 描述
  actor: ActorType;       // 'human' | 'machine' | 'hybrid'
  locked: boolean;        // 节点级锁定
  inputs: PortDef[];      // 输入端口 { id, name }[]
  outputs: PortDef[];     // 输出端口 { id, name }[]
  composite?: CompositeMeta; // 存在即表示该节点是组合节点
}

interface CompositeMeta {
  expanded: boolean;      // true=展开(虚线框) / false=塌缩(粗边框)
  childIds: string[];     // 子节点 id 列表
}
```

关键约定:

- 组合节点塌缩时,`data.inputs / data.outputs` 会被写入**聚合端口快照**(也用于属性面板展示)。
- 画布实时展示的聚合端口通过 `computeCompositePorts(children, edges)` 计算,二者可能短暂不同步,需保持一致。

### Edge

```ts
export type FlowEdge = Edge<FlowEdgeData, 'flow'>;

interface FlowEdgeData {
  label: string;              // 连线说明文字
  artifact: Artifact | null;  // 中间产物
}

interface Artifact {
  id: string;
  kind: ArtifactKind;   // 'document' | 'image' | 'video' | 'audio' | 'code' | 'data' | 'other'
  label: string;
  description: string;
}
```

关键约定:

- 组合节点内部连线(两端都是子节点)在塌缩时**仅置 `hidden: true`**,不改写端口,保证内部画布仍可渲染。
- 组合节点外部连线(一端在组合内)在塌缩时改写 `source/target` 指向组合节点,端口编码为 `cid:<childId>:<portId>`;展开时解码还原。

## Compound Node 设计原则

1. **组合即引用,不复制**:组合节点只保存 `childIds`,子节点与连线仍属同一全局图数据,不产生数据副本。
2. **聚合端口可逆编码**:聚合端口 id 形如 `cid:<childId>:<portId>`(`encodeCompositePort` / `decodeCompositePort`),任何时刻可还原到具体子节点端口。
3. **聚合规则**:内部节点的输入端口若无内部连线连入则聚合为组合输入;输出端口若无内部连线连出则聚合为组合输出。
4. **塌缩**:组合节点居中于子节点群;子节点与内部连线隐藏(`hidden: true`);外部连线改写为指向组合节点(可逆)。
5. **展开**:子节点与内部连线恢复显示;外部连线从 `cid:` 端口还原;组合节点变为虚线框,尺寸由 `computeCompositeBounds` 实时包裹全部子节点(展开态不可拖动);展开态左右边缘渲染聚合端口 Handle,可直接对外连线。
6. **删除组合节点前必须先展开**(`expandComposite`),以免误删其子节点与连线。
7. **撤销 / 重做 / 跳转历史**必须同步恢复内部画布标签(`compositeTabs / activeTabId`):`GraphSnapshot` 记录标签状态,历史跳转通过 `restoreTabsFromSnapshot` 完整恢复,避免指向已不存在的组合节点。
8. 组合节点自身不允许再嵌套组合(`groupSelected` 拒绝已含组合节点的选中集合)。

## 当前开发阶段

- 基于 Electron + React + React Flow + Zustand 的功能型编辑器,主体功能可用(节点/连线/中间产物/历史/自动保存/导入导出)。
- 组合节点(Composite Node)功能处于**完善阶段**:展开 / 塌缩、内部画布标签页、弹窗编辑、大纲面板适配均已实现,正在进行边界场景修复与一致性打磨。
- 关键文件:
  - `src/types.ts` — 数据模型
  - `src/store/graphStore.ts` — 状态、历史、组合节点逻辑(`collapseComposite` / `expandComposite` / `refreshCompositeHidden`)
  - `src/lib/composite.ts` — 端口编码与聚合计算
  - `src/components/FlowNodeComponent.tsx` — 节点三种形态(普通 / 展开虚线框 / 塌缩)
  - `src/components/FlowCanvas.tsx` — 主画布与内部画布切换
  - `src/components/CompositePopupView.tsx` — 组合节点弹窗编辑

## 已知问题

1. ~~**属性面板聚合端口为快照**~~(已修复):属性面板聚合输入/输出已改为实时调用 `computeCompositePorts`,与画布展示统一为单一数据源。
2. ~~**删除子节点可能遗留悬空外部连线**~~(已修复):`deleteNode` 与删除连线过滤逻辑通过 `edgeReferencesNode` 解码 `cid:` 端口,引用被删子节点的悬空连线会自动清理。
3. ~~**内部画布新建节点的隐藏状态绕开历史**~~(已修复):内部画布双击新建节点改走 `addNodeToComposite` action,「创建节点 + 加入 childIds + 塌缩态隐藏」合并为一次原子历史记录。
4. ~~**展开态组合节点无自身端口**~~(已修复):展开虚线框左右边缘渲染聚合端口 Handle(与塌缩态同为 `cid:` 编码),可直接对外连线;塌缩不改写聚合连线、再展开解码还原,状态机天然兼容。
5. **聚合端口快照冗余写入**:`collapseComposite` / `refreshCompositeHidden` 仍向 `data.inputs/outputs` 写入聚合端口快照,现仅作数据冗余与导出兼容,展示与画布均以 `computeCompositePorts` 实时计算为准;可逐步移除快照写入。
