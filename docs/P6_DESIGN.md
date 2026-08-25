# NodeFlow P6 — Document Format & Persistence 设计决策

> 性质：P6-01 / P6-02 / P6-02 Design Freeze Correction / P6-03 已完成并确认的架构设计固化。
>
> 状态：**已冻结**（Freeze）。后续 P6-04 实施必须以此为安全基线。
>
> 最后更新：2026-08-25

---

## 0. 目标

在不破坏现有 NodeFlow 功能和已有 `.nodeflow` 项目文件的前提下，把项目文件系统建设为**可以长期演进、向后兼容、可验证、可安全迁移**的正式文档格式。

> 核心原则：**先保护用户文件，再考虑代码优雅。**

P6 中心问题：

> **保护用户的 `.nodeflow` 文件，并让它能够随着 NodeFlow 长期发展而演进。**

---

## 1. P6 安全施工原则

1. **先分析，再设计，再修改**：P6-01 审计 → P6-02 设计 → P6-03 兼容 → P6-04 迁移 → ...（禁止一开始就改保存格式）。
2. **旧文件优先**：任何新格式设计都不能以牺牲旧 `.nodeflow` 文件为代价。
3. **禁止破坏性升级**：不改旧文件内容、不批量转换、不自动覆盖、不删除旧字段、不猜测未知字段/版本、不自动加载 future version、不静默丢弃数据。
4. **不借机重构**：不重写 graphStore、不统一 domain/lib、不重做 Composite/Gateway/Stage/Annotation、不换 Zustand/React Flow、不建数据库/云同步/插件系统。
5. **用户文件比代码更重要**：Code 可重构，UI 可变化，Domain 可变化，但用户文件必须尽可能长期可用。

---

## 2. P6 路线图

```
P6-01 当前文件格式审计        ✅ 完成(只读)
P6-02 Document/Version 设计   ✅ 完成(只读)
P6-02 Design Freeze Correction ✅ 完成(只读)
P6-03 Backward Compatibility  ✅ 完成(只读)
P6-04 Migration                ✅ 完成(实施:lib/document.ts + loadProject 接入)
P6-05 Safe Persistence         ✅ 完成(实施:localStorage version 字段 + Load/Save 安全)
P6-06 Document Validation      ✅ 完成(实施:validateDocumentData 接入 loadProject)
P6-07 Migration/Persistence Tests ✅ 完成(实施:document.test.ts 14 用例)
P6-08 Real Project Compatibility ⏳ 后续(与 P6-09/10 一起在 Feature Development 中按需补充)
P6-09 Error Handling
P6-10 Auto Save Safety
P6 Gate(部分)
```

> P6-04~07 已在本轮 Architecture Hardening 中实施并验证(143 测试通过)。P6-08~10(Real Project / Error Handling / Auto Save) 属增量增强,不在本轮范围。

> **实施结果**:新增 `src/lib/document.ts`(纯逻辑兼容层,无 React/Zustand/React Flow 依赖),`serializeProject` 升级为 Project Format v3,`loadProject` 接入 Format Detection / Future Version Gate / Migration / Import / Validation。详细见 `docs/DEVELOPMENT_LOG.md`。

---

## 3. P6-01 审计结论（已冻结）

### 3.1 当前 `.nodeflow` 项目文件格式（`serializeProject`,version 2）

```json
{
  "type": "nodeflow-project",
  "version": 2,
  "exportedAt": "<ISO 时间戳>",
  "project": {
    "id": "...", "name": "...", "color": "...",
    "nodes": [...], "edges": [...], "viewport": {...},
    "annotations": [...], "stages": [...],
    "compositeTabs": [...], "activeTabId": "...",
    "past": [...], "future": [...],
    "lastSavedAt": "...", "dirty": false
  }
}
```

### 3.2 当前静态 JSON 导出（`exportJson`,version 1）

```json
{ "version": 1, "exportedAt": "...", "nodes": [...], "edges": [...], "viewport": {...}, "annotations": [...], "stages": [...] }
```

### 3.3 当前 Save Flow

- 手动保存：`Toolbar.handleSaveProject` → `graphStore.serializeProject()` → Blob 下载 `.nodeflow`。
- 自动保存（localStorage）：`saveNow()`（debounce 600ms）→ `persistDocument()` 写 `nodeflow:doc:<id>:v1`；`persistDocsIndex()` 更新注册表。

### 3.4 当前 Load Flow

- 桌面端双击 / 打开：`electron/main.ts flushPendingFiles` → IPC → `App.onOpenProjectFile` → `graphStore.loadProject(json)`。
- 启动恢复：`buildInitialDocuments()`（注册表 + 旧单文档迁移）。

### 3.5 数据分类

| 类别 | 内容 |
|---|---|
| Document Data | nodes/edges/stages/annotations/name/color（用户项目资产,必须长期兼容） |
| Editor State | compositeTabs/activeTabId/viewport |
| UI State | selected/draggable/measured/pendingAutoEdit |
| Derived Data | hidden/聚合端口/组合包围盒 |
| Metadata | type/version/exportedAt |
| Runtime | past/future/lastSavedAt/dirty |

### 3.6 现有版本机制

**当前没有正式文件版本机制。** 有 `version` 字段名，但 `loadProject` **不读取校验 version**，未来版本可能被错误加载。

### 3.7 兼容性风险

| 风险 | 等级 |
|---|---|
| `version` 未校验（future version 可能被强行解析） | 🔴 High |
| `type` 缺失即回退静态格式 | 🟡 Medium |
| `project` 顶层封装 vs 平铺两套结构 | 🟡 Medium |
| 节点内嵌 UI/Derived 字段未清洗 | 🟡 Medium |
| history 栈写入 `.nodeflow` | 🟡 Medium |
| 损坏 JSON 静默空图 | 🟢 Low |

---

## 4. P6-02 设计（已冻结）

### 4.1 目标文件格式（Project Format v3）

```json
{
  "format": "nodeflow",
  "version": 3,
  "exportedAt": "...",
  "document": {
    "id": "doc_xxx", "name": "...", "color": "#4ea1ff",
    "graph": { "nodes": [...], "edges": [...], "stages": [...], "annotations": [...] },
    "editor": { "viewport": {...}, "activeTabId": "main", "compositeTabs": [...] }
  }
}
```

### 4.2 数据边界决策（已冻结）

| 决策 | 内容 |
|---|---|
| D1 | **历史栈不入 `.nodeflow`**（past/future 是 Runtime,打开后历史从空开始;旧文件含则忽略） |
| D2 | `viewport` 归入 Editor State（可选保存,未来可降级） |
| D3 | `compositeTabs`/`activeTabId` 归入 Editor State |
| D4 | `dirty`/`lastSavedAt` 不入文件（Runtime 标记） |
| — | `expanded`(composite) 是 Document 意图状态,**保存**;`hidden` 是 Derived,**不保存** |

### 4.3 版本识别表

| version | 含义 |
|---|---|
| 无 format/type | 旧静态导出 |
| v1 | 旧导出 `{version:1,...}` |
| v2 | 旧项目 `{type:'nodeflow-project',version:2,project}` |
| **v3** | 正式 `{format:'nodeflow',version:3,document}` |

### 4.4 JSON Export 格式

```json
{ "format": "nodeflow-export", "version": 1, "exportedAt": "...", "graph": { "nodes": [], "edges": [], "stages": [], "annotations": [] } }
```

### 4.5 localStorage 模型

| Key | 内容 | 版本 |
|---|---|---|
| `nodeflow:prefs:v1` | 用户偏好 | 不变 |
| `nodeflow:docs:v2` | 注册表 | 升级 |
| `nodeflow:doc:<id>:v2` | 单文档自动保存（无 history） | 升级 |
| `nodeflow:graph:v1` | 旧单文档 | 迁移源 |

---

## 5. P6-02 Design Freeze Correction（已冻结）

### 5.1 Correction #1 — Project ≠ Export 是两个 Format Family

```
Project Format  ≠  Export Format
format:"nodeflow"  vs  format:"nodeflow-export"
```

- 两者 version namespace **独立**,互不递增。
- **禁止** `Export v1 → Project v3` 作为 Migration Chain。

### 5.2 Migration vs Import

| 概念 | 语义 |
|---|---|
| **Project Migration** | 同一 Project Format Family 内 Schema Evolution（`v2 → Migration → v3`） |
| **Export Import/Conversion** | 外部/静态数据解释并映射成当前 Document（`Export → Import → NodeFlowDocument`） |

实现可复用同一纯转换函数,但**概念必须区分**。

### 5.3 最终 Migration/Import 矩阵

| Source | Family | Version | Process | Result |
|---|---|---:|---|---|
| Legacy Project | Project | 2 | Migration | Current Project |
| Current Project | Project | N | Load | Current Project |
| Future Project | Project | >N | **Reject** | None |
| Legacy Export | Export | 1 | Import/Conversion | Current Document |
| Current Export | Export | N | Import | Current Document |
| Invalid | Unknown | ? | **Reject** | None |

### 5.4 Correction #2 — Document ID 暂不定案

```
Current Fact:  loadProject() 重新生成 Runtime Document ID (uid('doc'))
P6-02 Decision: 不把当前行为升级为长期文件格式契约
Persistent Document ID: 暂不最终冻结
Implementation: P6-02 不修改
Future: 若需要稳定项目身份,再单独决定 Persistent ID + Open/Duplicate/Import 语义
```

### 5.5 保持不变的 P6-02 结论

- Document / Runtime / Derived / History / React Flow State 边界
- `expanded` = Document Composite State；`hidden` = Derived
- `past/future` = Runtime History（不入 v3）
- Future Version → Reject；Load Failure → 当前文档不变
- Architecture Hardening ≠ Architecture Expansion

---

## 6. P6-03 兼容性设计（已冻结）

### 6.1 Legacy Project v2 逐字段审计

依据 `loadProject` 实际字段提取 + 默认值：

| 字段 | 分类 | 缺失行为 |
|---|---|---|
| `id` | Deprecated | Runtime 重建（`uid('doc')`） |
| `name` | Defaultable | `'未命名项目'` |
| `color` | Defaultable | 循环调色板 |
| `nodes`/`edges` | Required | `Array.isArray ? : []`（核心图结构） |
| `viewport` | Defaultable(Editor) | `{x:0,y:0,zoom:1}` |
| `annotations`/`stages`/`compositeTabs` | Defaultable | `[]` |
| `activeTabId` | Defaultable(Editor) | `'main'` |
| `past`/`future` | Deprecated | Discard |
| `lastSavedAt` | Runtime 元数据 | `null` |
| `dirty` | Runtime | 恒 `false` |

### 6.2 Format Detection

- **Format + Version 共同决定解析路径**,禁止仅凭 `version` 判断。
- 有 `format`：`nodeflow`(Project) / `nodeflow-export`(Export) / unknown(Reject)。
- 无 `format`：`type==='nodeflow-project'`(Legacy Project v2)；否则按平铺结构识别 Legacy Export v1；无法识别 → Reject。

### 6.3 Version Detection

- Project namespace：v2(Legacy) / v3(Current) / >3(Reject)。
- Export namespace：v1(Legacy) / >supported(Reject)。

### 6.4 Future Version Gate（硬边界）

```
version < current → Migration
version === current → Load
version > current → Reject("此 NodeFlow 项目由更新版本创建,请升级 NodeFlow 后再打开")
```

- **禁止** Future Version「尽量读取」/ 空白项目 / 部分加载 / 自动覆盖。

### 6.5 Validation 分类

| 分类 | 含义 | 行为 |
|---|---|---|
| **Fatal** | Malformed JSON / unknown format / unsupported version / 缺核心结构 / Migration failure | Reject |
| **Recoverable** | 缺 viewport / 缺 optional / 缺 editor state | Default |
| **Derived** | hidden / 聚合端口 / bounds / measured | Recompute |

Validation 发现错误,不负责偷偷修复。

### 6.6 Composite Migration

```
Legacy expanded → Current expanded → refreshCompositeHidden() → hidden
```
- `expanded` 原样迁移（Document State）；`hidden` 丢弃重算（Derived）。
- 缺 `expanded` 默认 `false`（塌缩安全默认）。

### 6.7 React Flow 字段

| 字段 | v3 保存 | Migration | Hydration |
|---|---|---|---|
| `selected` | 剥离 | Discard | UI 重建 |
| `measured` | 剥离 | Discard | React Flow 重测 |
| `draggable` | 剥离(普通节点) | Discard | 强制 `true` |
| `hidden` | 剥离 | Discard | `refreshCompositeHidden` 重算 |

原则：**React Flow Runtime State ≠ 长期 Project Schema。**

### 6.8 History Migration

- v2 `past`/`future` → **Discard**，不转换为 v3 History。

### 6.9 Broken Reference 处理

| 引用 | 行为 |
|---|---|
| Edge→Node | 丢弃孤立边（Recoverable） |
| Composite→Child | 保留存在的 childId（Recoverable） |
| Stage→Node | 保留 stage,丢不存在 nodeId |
| Annotation→target | 丢不存在主体的注释 |
| Gateway→defaultBranch | 丢不存在出口连线的兜底 |
| 其余 | 可安全丢弃孤立引用 → Recoverable |

### 6.10 安全规则

- **Migration Failure → 当前文档不变 → 原文件不变**。
- Migration 是**纯函数**：不依赖 Zustand/React/React Flow/UI/localStorage/filesystem。
- Migration **deterministic**（不依赖 Date/Random/Store）；ID 生成放 Hydration 层。
- Migration **不 mutation 输入**（`const result = migrate(input)`）。
- **Save After Migration**：不在打开旧文件时直接覆盖；不自动升级保存（未来需 Atomic Save/Backup 设计）。

### 6.11 最小实现模型（概念示例,非强制函数名）

```
detectFormat() / detectVersion() / validateLegacyProject()
migrateProjectV2ToV3() / importLegacyExport() / validateCurrentDocument()
loadProjectSafely()   // orchestration
```

---

## 7. 兼容性矩阵（最终）

| Input | Format | Version | Action | Failure Safety |
|---|---|---:|---|---|
| Legacy Project | Project | 2 | Migrate | Current doc unchanged on failure |
| Current Project | Project | 3 | Load | Current doc unchanged on failure |
| Future Project | Project | >3 | Reject | Current doc unchanged |
| Legacy Export | Export | 1 | Import | Current doc unchanged on failure |
| Future Export | Export | >1 | Reject/explicit | Current doc unchanged |
| Unknown | Unknown | ? | Reject | Current doc unchanged |
| Corrupted | Unknown | ? | Reject | Current doc unchanged |

---

## 8. P6 明确不做

- 不统一 `domain/` 与 `lib/`
- 不重构 graphStore
- 不重写 Composite / Gateway / Stage / Annotation
- 不更换 React Flow / Zustand
- 不建数据库 / 云同步 / 插件系统
- 不做 React Flow Adapter
- 不做 Persistent Document ID（暂不定案）
- 不做 Open/Duplicate/Import ID 策略实现
- 不做 Atomic Save 实现
- 不增加产品功能

---

## 9. P6 已知技术债

P5.5 已发现以下 lib 文件不完全属于纯逻辑层,但 **P6 默认不处理**（仅当 Document/Persistence 工作确实需要时才允许局部调整）：
- `lib/compositePopup.ts`（反向依赖 graphStore）
- `lib/exportImage.ts`
- `lib/closeProject.ts`
- `exportSvg.downloadSvg`

---

## 10. P6 Gate（预留对照）

P6 完成前须满足：完整审计格式 / 正式 format identifier / 明确 version / Document-Editor 边界 / 旧文件可开 / Migration 有测试 / Future version 不误开 / Unknown version 拒绝 / Save-Load-roundtrip 正常 / Save failure 不破坏旧文件 / 原有测试通过 / tsc / build 通过。

---

## 11. 设计文档来源

- `docs/DEVELOPMENT_LOG.md`：开发日志（P5 起逐阶段记录）
- P6-01 审计：本文件 §3
- P6-02 设计：本文件 §4
- P6-02 Freeze Correction：本文件 §5
- P6-03 兼容设计：本文件 §6-7

> 本文件将 P6-01~P6-03 已确认的架构决策从对话历史固化为仓库正式文档，作为 P6-04 实施的安全基线。
