# COMPOUND_NODE_DESIGN.md — 组合节点(Compound Node)设计

> 本文档描述组合节点(代码中也称 Composite Node)的数据模型、状态机、聚合端口算法与实现要点。这是当前项目最核心、最复杂的子系统。

## 1. 数据模型

```ts
interface CompositeMeta {
  expanded: boolean;      // true=展开(虚线框) / false=塌缩(粗边框)
  childIds: string[];     // 子节点 id 列表(顺序即创建顺序)
}
```

- 组合节点是一个普通的 `FlowNode`,仅 `data.composite` 字段非空。
- **组合即引用,不复制**:`childIds` 只保存 id 引用,子节点与连线仍位于全局 `nodes / edges`,通过 `hidden` 字段控制显隐。

## 2. 两种形态

### 2.1 展开态 (expanded = true)

- 渲染为**虚线框** `.nf-composite-frame`,包裹全部子节点。
- 虚线框尺寸由 `computeCompositeBounds(children)` 实时计算(最小边距常量),**不可拖动**,内部节点可自由编辑。
- 框顶部为标题栏(可编辑标题 + 塌缩按钮 + 标签页按钮 + 弹窗按钮 + 锁定按钮)与子节点数量提示。
- 左右边缘渲染**聚合端口 Handle**(id 与塌缩态一致为 `cid:` 编码),可直接对外连线;端口端点落在虚线框边缘,塌缩后保持指向组合节点聚合端口,再展开还原到内部子节点端口。

### 2.2 塌缩态 (expanded = false)

- 渲染为**普通节点外观 + 粗边框** `.nf-composite-node`,标题旁带 `⧉` 图标。
- 端口为**聚合端口**:来自内部节点未连接的端口,只读展示,可直接对外连线。
- 双击节点也可切换展开 / 塌缩。

## 3. 聚合端口算法

### 3.1 端口编码

聚合端口 id 采用可逆编码,端口名格式为 `cid:<childId>:<portId>`:

```ts
// lib/composite.ts
encodeCompositePort(childId, portId) // => `cid:${childId}:${portId}`
decodeCompositePort(portId)         // => { childId, portId } | null
```

**聚合规则**(`computeCompositePorts(children, edges)`):

- **输入**:内部节点的输入端口,若无内部连线连入,则聚合为组合输入。
- **输出**:内部节点的输出端口,若无内部连线连出,则聚合为组合输出。
- 端口名显示为子节点端口名;重复名时以 `节点名.端口名` 区分(由实现决定)。

### 3.2 快照与实时计算

- 画布渲染(`FlowNodeComponent`)与属性面板(`PropertiesPanel`)均通过 `computeCompositePorts` **实时计算**聚合端口,二者使用同一数据源,不会不一致。
- `collapseComposite` / `refreshCompositeHidden` 仍会向 `data.inputs / data.outputs` 写入聚合端口**快照**,但现仅作数据冗余与导出兼容,**不再参与展示**;可逐步移除。

## 4. 状态转换

### 4.1 创建组合 (groupSelected)

前置条件:选中 **≥2 个** 且 **均非组合节点** 的节点。

```
1. 生成组合节点 id,取选中节点包围盒中心作为组合节点位置
2. 组合节点 actor = 多数派(取第一个节点主体,由实现决定)
3. data.composite = { expanded: true, childIds: 选中节点 id 列表 }
4. 进入塌缩流程(collapseComposite)
```

### 4.2 塌缩 (collapseComposite)

```
1. 若处于展开态:计算组合边界,组合节点定位到子节点群中心
2. 聚合端口计算,写入 data.inputs / data.outputs 快照
3. 子节点 → hidden: true
4. 内部连线(两端均在 childIds)→ hidden: true
5. 外部连线(一端在内部,一端在外部):
   - 如果 source 是内部节点 → source/sourceHandle 改写为组合节点 + cid: 端口
   - 如果 target 是内部节点 → target/targetHandle 改写为组合节点 + cid: 端口
6. expanded = false
```

### 4.3 展开 (expandComposite)

```
1. 子节点 → hidden: false
2. 内部连线 → hidden: false
3. 外部连线:
   - 解码 cid: 端口 → 还原为原始子节点端口
   - 注意:绝不能强制显示其他仍处于塌缩状态的组合的连线
4. expanded = true,虚线框自动包裹
```

### 4.4 删除组合节点

```
1. 必须先 expandComposite(恢复子节点与连线),否则会连带删除内部内容
2. 然后删除组合节点本体
```

### 4.5 隐藏状态刷新 (refreshCompositeHidden)

遍历所有组合节点,按上述规则重新计算每个节点的 `hidden`,用于内部画布编辑后同步主画布显隐。

## 5. 内部画布

组合节点内部编辑的三种入口:

| 入口 | 形式 | 说明 |
| --- | --- | --- |
| 展开虚线框 | 主画布内联 | 直接在虚线框内编辑子节点 |
| 标签页 (Tab) | 主窗口内切换 | `compositeTabs` + `activeTabId`,在主画布与内部画布之间切换 |
| 弹窗 (Popup) | 独立窗口 | `openCompositePopup`,通过 localStorage 快照只读展示 |

- 内部画布同样使用 `FlowCanvas` + ReactFlow,渲染 `childIds` 对应的子节点与内部连线。
- 在内部画布新建节点通过 store action `addNodeToComposite(compositeId, position)` 原子完成:创建节点、写入组合 `childIds`、塌缩态自动标记 `hidden: true`(在主画布隐藏),并合并为一次历史记录。
- 标签页与历史联动:撤销 / 重做 / 跳转历史时同步重置 `compositeTabs / activeTabId`,避免指向不存在的组合。

## 6. 设计原则(汇总)

1. **组合即引用,不复制数据。**
2. **聚合端口可逆编码**(`cid:` 前缀),任何时刻可还原到子节点端口。
3. **塌缩是主画布侧的显隐切换**:内部数据永远完整,仅 `hidden` 变化。
4. **外部连线改写是唯一破坏性操作**,必须可逆、且不得影响其他组合。
5. **删除组合前必须先展开。**
6. **历史 / 标签页 / 弹窗的一致性**由 store 统一维护。
7. **组合不嵌套组合**(创建时拒绝含组合节点的选中集)。

## 7. 实现位置

| 逻辑 | 位置 |
| --- | --- |
| 端口编码 / 聚合计算 / 边界计算 | `src/lib/composite.ts` |
| 塌缩 / 展开 / 创建 / 删除 / 隐藏刷新 | `src/store/graphStore.ts` |
| 三种形态渲染 | `src/components/FlowNodeComponent.tsx` |
| 内部画布(标签页 + 弹窗入口) | `src/components/FlowCanvas.tsx` |
| 弹窗只读视图 | `src/components/CompositePopupView.tsx` |
| 弹窗快照读写 | `src/lib/compositePopup.ts` |
| 大纲 / 属性面板适配 | `src/components/OutlinePanel.tsx` / `PropertiesPanel.tsx` |
