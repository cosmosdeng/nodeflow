# TODO.md — 待办清单

> 优先处理 P0(正确性问题) → P1(体验问题) → P2(规划增强)。

## P0 · 正确性缺陷

- [x] **塌缩状态删除子节点后清理悬空外部连线**(已完成)
  - 修复:`graphStore.ts` 新增 `edgeReferencesNode` 辅助函数,`deleteNode` 与 `onNodesChange` 删除分支在过滤连线时解码 `cid:` 端口,引用被删子节点的悬空连线一并清理;删除后统一 `refreshCompositeHidden` 刷新聚合端口与隐藏状态。

- [x] **聚合端口快照与实时计算的一致性**(已完成,展示侧)
  - 修复:`PropertiesPanel.tsx` 聚合输入/输出改为实时调用 `computeCompositePorts`,与画布展示统一为单一数据源。
  - 遗留(后续清理):`collapseComposite` / `refreshCompositeHidden` 仍向 `data.inputs/outputs` 写入快照,现仅作数据冗余与导出兼容,可逐步移除。

- [x] **内部画布新建节点绕开历史记录**(已完成)
  - 修复:新增 store action `addNodeToComposite(compositeId, position)`,原子完成「创建节点 + 加入 childIds + 塌缩态隐藏」并一次性记录历史;`FlowCanvas` 内部画布双击新建改走该 action,不再 `setState` 直改 `hidden`。

## P1 · 体验与健壮性

- [x] **展开态组合节点的对外连线能力**(已完成)
  - 修复:`FlowNodeComponent` 展开态(虚线框)左右边缘渲染聚合端口 Handle,端口 id 与塌缩态一致(`cid:` 编码),可直接对外连线;塌缩 / 展开逻辑天然兼容(展开态聚合连线指向组合节点,塌缩不改写,再展开解码还原)。
  - 说明:展开态聚合端口连线端点落在虚线框边缘,塌缩后保持指向组合节点聚合端口,再展开还原到内部子节点端口。

- [x] **弹窗快照过期提示增强**(已完成)
  - 修复:`CompositePopupView` 监听 `storage` 事件实时刷新快照(主窗口重新弹出覆盖快照时自动同步),并增加 2s 轮询兜底,避免遗漏存储事件;不再需要手动回主窗口重建。

- [x] **组合节点创建时的 actor 与标题**(已完成)
  - 修复:`graphStore` 新增 `majorityActor` 按子节点多数派推断执行主体;`groupSelected` 生成的组合节点标题为「{主体}协作流程(N)」(平手按 human → machine → hybrid 优先级)。

- [x] **聚合端口重名区分**(已完成)
  - 修复:`computeCompositePorts` 对同一方向内重名的端口按「节点名.端口名」降级命名,端口 id 仍为 `cid:` 编码不受影响。

- [x] **撤销 / 重做内部画布标签联动**(已完成)
  - 修复:`GraphSnapshot` 增加 `compositeTabs` / `activeTabId`;`markHistory` 记录标签状态,`undo` / `redo` / `jumpTo` 通过新增的 `restoreTabsFromSnapshot` 完整恢复标签页;旧快照(无标签字段)回退为按节点过滤,保证任何历史跳转都不会残留指向不存在组合的标签页。

## P2 · 规划增强

- [ ] **组合节点嵌套组合**
  当前 `groupSelected` 拒绝含组合节点的选中集。后续可放开一层嵌套(需更新聚合规则与递归显隐)。

- [ ] **复制 / 粘贴节点与组合**
  支持跨组合复制子图,复制时生成新的 `childIds` 与端口映射。

- [ ] **自动布局(组合内对齐)**
  组合内节点一键自动排列(横向 / 纵向),减少手动摆放成本。

- [ ] **组合节点样式定制**
  边框颜色 / 图标 / 折叠动画等可配置项。

- [ ] **单元测试覆盖核心纯函数**
  `lib/composite.ts` 的编码 / 解码 / 聚合 / 边界计算,以及 graphStore 的塌缩 / 展开状态机。

- [ ] **多画布 / 多文档**
  单文档扩展为多文档管理(新建 / 打开 / 最近文件)。
