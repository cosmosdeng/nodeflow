# PROGRESS — 开发进展记录

> 按日期追加。每条记录：做了什么、验证结果、遗留事项、对应提交。

---

## 2026-10-27（二）自动排列：加大矩阵间距 + 连线感知列缝隙（减少连线大弧避让）

### 背景 / 目标

用户反馈「自动排列后连线在避开节点时过于激进、拱得很远」，希望**从排列源头**优化：合理分布节点与间距，避免两个节点端点挨得太紧导致连线被迫大弧度避让；同时让连线重叠最小化、避让努力最小化。

### 改动

在 `computeMatrixGridGeometry`（排列与渲染共用的唯一几何权威）：

**1. 加大矩阵基础间距**（拉开节点端点间距，给连线留出直出直进的横向空间）

| 常量 | 旧 | 新 |
|---|---|---|
| `MATRIX_COL_GAP`（相邻 Stage 列） | 120 | 150 |
| `MATRIX_ROW_GAP`（行） | 80 | 104 |
| `MATRIX_STACK_GAP`（同 cell 纵向堆叠） | 40 | 54 |
| `MATRIX_LAYER_GAP`（列内相邻拓扑层） | 60 | 78 |

**2. 连线感知列缝隙**：相邻两列之间每多一条「跨列连线」，该列缝隙再宽 `MATRIX_EDGE_GAP_PER_EDGE=12`（上限 `MATRIX_EDGE_GAP_MAX=96`）。跨列连线越多，列间横向空隙越大 → 连线有更充足纵向空间展开，减少互相重叠、避免端点过近时的大弧避让。

### 验证

- **单元测试**：496 用例 / 51 文件全绿，新增 1 用例「有跨列连线的列缝隙比无连线更宽」；同步了 5 处硬编码旧间距常量的测试（matrixLayout / matrixBandLayout / stageOnlyAnchor / graphStore.order.p3）。
- **类型 / Lint / Format / 构建**：全部通过。

### 遗留

- 连线感知仅针对「入矩阵 assigned 节点间的跨列连线」（`nodeColOf` 只含 assigned cell）；涉及 stageOnly / free / rowOnly 端点的边仍走基础缝隙，暂不叠加。
- smoothstep（直角线）在 `edgePath.ts` 仍未设绕障上限（前一条已记录）。

---

## 2026-10-27（二）修复预览白屏：连线绕障 selector 无限重渲染

### 现象

`http://127.0.0.1:5173/` 打开后**一片空白**,`#root` 内无任何 DOM。dev server 日志无报错(编译正常),`tsc` / lint / 473 个单测全绿 —— 典型的「只有真跑起来才暴露」的运行时崩溃。

### 定位

用无头 Chrome 抓控制台(`--enable-logging=stderr --virtual-time-budget`):

```
Warning: The result of getSnapshot should be cached to avoid an infinite loop
Uncaught Error: Maximum update depth exceeded. (…)
The above error occurred in the <FlowEdgeComponent> component
```

### 根因

`FlowEdgeComponent` 把「每次新建对象」的派生结果直接塞进了 zustand selector:

```ts
const obstacles = useGraphStore(useShallow((s) => { …; rects.push({ x, y, width, height }); return rects; }));
```

`useShallow` 只做**一层**浅比较,而数组元素是每次新建的 `{x,y,width,height}`,引用永远不同 → 快照恒不相等 → `getSnapshot` 不稳定 → 无限重渲染 → React 抛错卸载整棵树 → 白屏。

### 修复

| 项 | 内容 |
|---|---|
| **组件** | 只订阅稳定的 `s.nodes` 引用,再用 `useMemo` 派生障碍矩形(`src/components/FlowEdgeComponent.tsx`) |
| **纯函数** | 派生逻辑抽为 `collectEdgeObstacles(nodes, sourceId, fallback)`(`src/lib/edgePath.ts`),排除 source / hidden、未测量尺寸回落 230×120 |
| **测试** | 新增 `src/lib/__tests__/edgeObstacles.test.ts` 5 用例(排除 source、排除 hidden、实测/回落尺寸、自定义 fallback、空输入) |

### 验证

- **页面**:无头 Chrome dump-dom 可见完整 App DOM(`<div class="app">…`),连线 path 正常渲染,**无任何 console 错误**
- **测试**:478 用例 / 50 文件全绿
- **类型 / Lint / 构建**:`tsc` 干净、lint 0 error / 1 warn、`format:check` 与 `build` 通过

### 经验(重要)

1. **zustand selector 只返回稳定引用**:selector 内不要 `map` / `filter` 出新对象,不要 `push` 新字面量;需要派生就用「订阅原始 slice + `useMemo`」。`useShallow` 只适用于元素引用稳定的数组(如 `annotations.filter(...)` 返回原对象)。
2. **`tsc` + 单测全绿 ≠ 页面能跑**:这类无限重渲染只有真实渲染才触发。这正说明「组件层 0 测试」的代价 —— 组件测试应是下一优先级。

---

## 2026-10-27（二）修复连线与端口「断开」：绕障 bezier 拼接吞掉后半段

### 现象

白屏修复后页面能渲染了,用户反馈「连线和节点的输入输出很多都断开了」—— 多条弧线的终点悬在半空,不落在目标端口上(尤其网关分支的彩色线)。

### 根因

`buildBezierAvoiding` 把两段贝塞尔拼成一条 path 时,用 `/^M[^L]*L?/` 删除第二段开头的「M + 坐标」。但 `getBezierPath` 的输出形如 `M0,0 C150,0 150,200 300,200`,**根本不含 L 命令** —— `[^L]*` 会把整段第二段(中途绕行点 → target)全部吞光,路径只剩第一段,终点悬空在绕行中点。

- **引入时间**:`git log -S` 显示该正则从 v0.1.0 P2(`cd93263`)就存在 —— 是个老 bug;此前不明显是因为画布简单、命中绕障的线少,近期画布变复杂 + `421f7ac` 的采样检测后才大量暴露。
- **为什么测试没拦住**:既有绕障用例只断言「路径含 C」「有绕行偏移」,从未断言**终点坐标**。

### 修复

| 项 | 内容 |
|---|---|
| **正则** | 改为 `/^M[-\d.,\s]+/`:只吃掉 M 指令及其后的数字坐标,在第一个字母命令(C)前停下,保留第二段曲线 |
| **回归测试** | 新增 2 用例:bezier / smoothstep 绕障路径的**末尾坐标必须等于 targetX, targetY**(smoothstep 一直是对的,一并锁住) |

### 验证

- **单元测试**:480 用例 / 50 文件全绿(新增 2)
- **类型 / Lint / Format / 构建**:`tsc` 干净、lint 0 error / 1 warn、`format:check` 通过、`build` 通过
- **预览**:待用户刷新确认弧线是否都落回端口

### 经验

1. **拼接 path 字符串时,断言终点**:路径类纯函数的测试必须校验首/尾坐标,「包含某命令」这类断言挡不住结构性截断。
2. 老代码 + 新触发条件 = 看起来像「新 bug」;用 `git log -S` 定位引入点能避免误判回归范围。

---

## 2026-10-27（二）绕障弧线中点拐角：改单段三次贝塞尔

### 现象

用户反馈「连线中间在连线说明和连线产物附近会有一个拐弯,不平滑」—— 拐角正好落在线中点,也就是标签 / 产物 chip 所在处。

### 根因

弧线绕障原为「source→绕行中点」+「绕行中点→target」**两段贝塞尔拼接**:两段曲线在拼接点的切线方向由各自的 handle 朝向(`midIn` / `midOut`)决定,而这两个朝向被设成与 S→T 主方向**垂直**,与曲线实际进出方向不一致 —— 拼接处 G1 不连续,必然出现可见拐角;而 `labelX/labelY` 恰好取这个中点,所以拐角就贴在连线说明旁边。

### 修复

| 项 | 内容 |
|---|---|
| **单段三次贝塞尔** | 去掉拼接:控制点按绕行侧外推(`c1 = source + 0.35·主方向 + bend·绕行方向`),整条曲线 C1 连续,不存在拼接点 |
| **避障校验** | 用现有 `sampleSvgPath` 采样生成曲线,若仍压到障碍就把 `bend × 1.35` 重试(最多 8 次,上限 1200),保证绕得开 |
| **标签位置** | 改为曲线参数中点 `t=0.5`( `(P0 + 3c1 + 3c2 + P3)/8` ),落在曲线真正走过的地方,而不是几何中点 |

### 验证

- **单元测试**:483 用例 / 50 文件全绿,新增 3 用例 —— ① 绕障路径必须是**单段**(M / C 各出现 1 次,防回归到拼接)② 相邻切线夹角 < 90°(无折返拐点)③ 采样点不落在障碍实体上,且标签落在绕行段上
- **类型 / Lint / Format / 构建**:全部通过
- **预览**:待用户确认拐角是否消失

### 经验

路径「平滑」是可测的:对曲线采样后断言相邻切线夹角上限,比肉眼截图检查更可靠 —— 这次的拐角正是之前测试只断言「含 C / 有偏移」而漏掉的。

---

## 2026-10-27（二）连线「很奇怪」的真凶：绕障判定 100% 触发

### 现象

修掉中点拐角后用户仍反馈「线这么奇怪」——弧线全被拱成大弯,完全不像自然的贝塞尔弧线。

### 根因

`collectEdgeObstacles` 只排除了 **source**,保留了 target:

```ts
if (n.id === sourceId || n.hidden) continue; // target 仍在障碍列表里
```

而**任何连线的原生路径终点必然落在 target 节点矩形(外扩 padding 24)内** → `hits` 判定恒成立 → **每一条线都被送去走绕障路径**,弧线被整体拱出去。

也就是说:前面修的「终点悬空」「中点拐角」都是**绕障路径内部**的问题,而真正让所有线变形的是这条过度设计 —— 当初把 target 当障碍是想让标签不压在 target 上,代价是 100% 的线失去自然形态。

### 修复

| 项 | 内容 |
|---|---|
| **排除 target** | `collectEdgeObstacles(nodes, sourceId, targetId?, fallback?)` 同时排除 source 与 target;绕障只为「穿过第三者节点」触发 |
| **组件** | `FlowEdgeComponent` 传入 `target`,依赖数组加 `target` |
| **拱形收窄** | 控制点外推系数 1.6 → **1.35**(三次贝塞尔在 `t=0.5` 处偏移为 `0.75·bend`,1.35 倍刚好把曲线拱到绕行通道,不再外扩过头) |
| **测试** | 新增 3 用例:排除 target 的单元断言(含回归说明)、未传 target 时只排除 source、集成用例(`collectEdgeObstacles → computeEdgePath`,无第三者时必须走原生路径) |

### 验证

- **单元测试**:485 用例 / 50 文件全绿(新增 3)
- **类型 / Lint / Format / 构建**:全部通过
- **预览**:待用户刷新确认

### 经验

「绕障」这类视觉增强必须能**证明它真的只在需要时触发**。如果把「必然成立」的几何条件(终点落在目标节点内)当成触发条件,功能就从「偶尔绕一下」退化成「永远在绕」——而且因为路径本身没报错,只有肉眼才看得出来。对这类功能应有一条反向断言:**无中间障碍时必须等于原生路径**。

---

## 2026-10-27（二）绕障弧线「拱太远」：改采样驱动的最小外推量

### 现象

用户反馈「连线在避开节点的时候过于激进,拱得很远」—— 绕障弧线绕到障碍边缘外很远,视觉上过度弯曲。

### 根因

`buildBezierAvoiding` 的初始外推量 `bend` 直接用「绕行通道坐标」估算:

```ts
const margin = padding + 40;                                    // 额外 40px
const passY = sourceY >= cy ? r.y - margin : r.y + r.height + margin;
let bend = Math.max(40, Math.abs(passY - midY) * 1.35);        // 一开始就拱到障碍边外 64px
```

而且后续循环只 `bend *= 1.35` **只增不减**,曲线永远贴不回障碍。结果是弧线总是绕到障碍边缘外 `padding(24) + 40 = 64px`,视觉上「太激进」。

### 修复

改为**采样驱动的最小搜索**:从很小的 `bend=24` 起步,采样生成曲线,只要仍压到障碍(带 `padding`)就 `bend × 1.3`,直到「刚好」避开为止 —— 曲线贴着障碍走,只拱到避障所需的最小高度。

| 项 | 内容 |
|---|---|
| **初始值** | `bend = 24`(不再用绕行通道坐标估算) |
| **方向** | 保留「远离 source 一侧」语义:`dirY/dirX` 由 source 与障碍中心的相对位置决定 |
| **循环** | 采样校验,压到障碍才增大(`×1.3`,最多 32 次),避开即停 |

### 验证

- **单元测试**:493 用例 / 51 文件全绿,新增 1 用例 —— 绕障弧线中点偏移 `|labelY| ∈ (60, 120)`:既确实绕过障碍半高(60),又不超过「半高 + padding + 余量」(旧实现约 125,会失败)
- **类型 / Lint / Format / 构建**:全部通过

### 遗留

多障碍场景仍用 `unionRects` 并集包围盒统一绕行:若一条线穿过**多个分散**节点,并集矩形会很大,最小外推量也随之变大(客观上绕开整个并集)。更优的做法是「逐个障碍绕行 / 只绕最近障碍」,待进一步确认是否需要。

---

## 2026-10-27（二）连线改为「温和避让」：巨障紧贴端口时放弃绕障、盖上节点

### 现象

用户反馈「连线在避开节点的时候过于激进」—— 两个节点挨得很近时,连接在**输出输出端点**上的连线,为避让旁边的节点,从几乎**法线方向**往外拱出巨大弧线。

### 设计取向（用户明确）

**不需要完全避让,只需温和避让**:如果节点位置关系很近了,那该覆盖在节点上就覆盖 —— 宁可盖上节点,也不要激进出大弯。

### 修复

在上一步「采样驱动最小搜索」之上加**拱出上限**:

```ts
const span = (Math.abs(dx) + Math.abs(dy)) / 2;   // 端口间距的一半
const maxBend = Math.max(40, span);                    // 允许的最大拱出量
...
if (bend > maxBend) return null;   // 再拱就成法线巨弧 → 放弃绕障
```

`buildBezierAvoiding` 返回 `PathResult | null`;`computeEdgePath` 对 bezier 绕障失败(`null`)时**回退到原生路径**(盖上节点)。

| 情形 | 结果 |
|---|---|
| 附近有空间、轻轻一拱就能避开 | 温和绕开(采样驱动找最小外推量) |
| 障碍紧贴端口、必须硬拱成法线巨弧 | 放弃绕障,用原生路径盖上节点 |

### 验证

- **单元测试**:495 用例 / 51 文件全绿,新增 2 用例 —— 远离端口的障碍仍绕开(不放弃);巨障贴两边时回退原生路径(与无助测试路径相同)
- **类型 / Lint / Format / 构建**:全部通过

### 遗留

smoothstep(直角线)仍是无条件绕障(`buildSmoothAvoiding` 不设上限),若直角线也有类似激进问题可同样加回退。

---

## 2026-10-27（二）自动排列「乱套」定位：锁定节点被排列搬走

### 现象（用户截图,本轮已能看到）

画布有 2 条参与方带 + 1 条阶段带;带内节点(脚本概写、人机协作蓝图、需求拆解等)**其实已按矩阵落位**;散落在带外的节点(新节点 ×2、人群需求扩、细节节点、投稿上链)与带内节点距离很远,底部出现巨大绕障弧线。

### 根因

散落节点上都有 🔒。排查发现**排列链路(`structure.ts` / `arrange.ts` / `matrixClassification.ts` / `freePlacement.ts`)中 `locked` 零命中** —— 单节点锁定在自动排列时被完全无视。

而锁定语义本应是「不可移动」:`FlowCanvas.tsx:1025` 明确以 `draggable=false` 拦截锁定节点的拖拽。**用户拖不动的节点,自动排列却随意搬走** —— 这就是「乱套」:锁定节点被强搬到矩阵/拓扑位置上,与其它节点距离拉远,长弧线随之出现。

### 修复

三条排列路径统一在**布局输入**中剔除 `data.locked` 节点(它们不产生目标位置,写回时自然保留原位):

| 路径 | 位置 | 改动 |
|---|---|---|
| `runArrange`(矩阵) | `structure.ts` | `computeMatrixLayout` 输入 `nodes: s.nodes.filter(n => !n.data?.locked)` |
| `runSmartArrange`(矩阵) | `structure.ts` | 同上 |
| `runSmartArrange`(legacy 拓扑) | `structure.ts` | `tops` 过滤加 `!n.data?.locked` |
| `autoLayout`(组合内部/全画布) | `flow.ts` | `targets` 过滤加 `!n.data?.locked` |

### 验证

- **单元测试**:492 用例 / 51 文件全绿,新增 2 用例(矩阵路径 / legacy 路径:锁定节点位置不变,其余照常排列)
- **类型 / Lint / Format / 构建**:全部通过

### 遗留说明

- 未锁定但**未挂语义**的节点按 Phase 2 冻结设计「保持原位,仅避让带区」——语义稀薄时排列效果有限属设计行为;若要「全图拓扑重排」,需改动该冻结设计(待用户拍板)。
- 锁定节点保持原位后,可能与排列后的其它节点重叠(排列不为锁定节点留位);属可接受的折衷,后续可为 freePlacement 增加「避开锁定节点」约束。

---

## 2026-10-27（二）「自动排列乱套」排查：算法无回归,待真实数据定位

### 排查结论（证据）

| 检查项 | 结果 |
|---|---|
| 布局代码是否被改动 | **零改动**：`git diff v0.4.0-next.4..HEAD -- src/lib/arrange.ts src/lib/layout.ts src/lib/geometry.ts src/lib/stage.ts src/components/MatrixVisualLayer.tsx` 为空 |
| 既有布局测试 | **81 用例全绿**（arrange / layout / matrixLayout / matrixGrid / matrixBandLayout / freePlacement / stageOnlyAnchor / arrangeConvergence） |
| 实测边缘场景 | 语义稀薄、语义完整、顺序数组含陈旧 id 三种形态下：**无重叠、无 NaN、无节点被推到极远处** |
| 阶段框是否错位 | **否**：`MatrixVisualLayer` 按 `store 实时 node.position` 绘制（文件头注释即声明「Arrange 的唯一输出」），band 会跟随节点，不会停在旧坐标 |
| 排列是否可恢复 | **是**：单次历史，一次 `Ctrl+Z` 完全还原（已有回归测试锁住） |

### 已做的加固

新增 `src/store/__tests__/graphStore.arrangeRobustness.test.ts`（5 用例）：语义稀薄 / 语义完整 / `stageOrder` 含陈旧 id / 包围盒可控 / **排列是单次历史可一次撤销** —— 锁住「真实文档形态下排列不得产出重叠与飞出画布」。

### 待用户配合

自动排列的「乱」无法用空演示文档复现（headless Chrome 只有默认数据）。需要用户提供：当前项目导出文件（文件 → 导出），或描述「乱」的具体形态（节点重叠 / 跑到画布外 / 顺序错乱 / 语义框与节点分离）。

### 备注

`runSmartArrange` 只写 `nodes.position`（`structure.ts:323-343`），不调用 `fitView`；若排列后包围盒远大于视口（实测语义稀薄场景宽 2816px），用户可能看到节点跑到视口外 —— 这是待确认的观感来源之一，是否加「排列后自动 fitView」需用户拍板（会改变既有行为）。

---

## 2026-10-27（二）批量归属补「取消归属」+ 幂等短路

补齐 2026-10-21 遗留的第一条：批量归属只能「加」不能「减」，取消归属要逐节点清空。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **批量取消归属** | 语义面板提示条右侧新增「⊘ 清参与方」「⊘ 脱阶段」：前者对选中节点批量清空 `participantId`，后者让选中节点脱离所有阶段；复用 `assignParticipantToMany(ids, null)` / `assignStageToMany(ids, null)`，整批一次历史 | `src/components/SemanticPanel.tsx` |
| **幂等短路** | 两个批量 action 增加「目标状态 = 现状」判定：重复点同一 `⊕`、对已无归属的节点点 `⊘`、把已在目标阶段的节点再归属一次，都不写历史、不产生空撤销步 | `src/store/slices/structure.ts` |
| **样式** | `.mx-bulk-hint` 改两端布局（文字 + 按钮组），新增 `.mx-bulk-actions`（按钮悬停转 `--danger`，disabled 降透明度） | `src/styles/global.css` |
| **测试** | 批量归属测试 12 → 18 用例：幂等短路不写历史、批量取消单次历史可撤销、全未归属时取消不写历史、先归属再取消两条历史逐次还原、阶段批量脱离与幂等 | `src/store/__tests__/graphStore.bulkAssign.test.ts` |

### 验证

- **单元测试**：473 用例 / 49 文件全绿（新增 6）
- **类型检查**：`tsc` 干净
- **Lint**：0 error / 1 warning（既有 `EditableText`）
- **Format / 构建**：`format:check` 通过、`bun run build` 通过
- **预览**：dev server `http://127.0.0.1:5173/` 待人工确认

### 遗留

1. 组件层仍为 0 测试，本次 UI 改动依赖 store 层测试 + 人工预览
2. `syncActiveDoc` 与自动保存双写 documents、`MIRROR_FIELDS` 手工维护仍未处理
3. 大纲栏分组选择不记忆

---

## 2026-10-21（三）语义面板批量归属

补上 v0.4.0-next.4 遗留的第一项：语义此前只能**逐节点**赋值，批量场景要在属性栏重复操作 N 次。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **批量归属 action** | 新增 `assignParticipantToMany(nodeIds, participantId)` 与 `assignStageToMany(nodeIds, stageId)`：整批**单次** `markHistory()`，`Ctrl+Z` 一步还原全部节点；阶段沿用单归属语义（先从原阶段移出再加入）；非法 id / 空列表 / 演示锁定下静默返回，不记历史 | `src/store/slices/structure.ts` + `src/store/types.ts` |
| **语义面板交互** | `SemanticOrderList` 行尾新增 `⊕` 批量归属按钮（无选中节点时禁用并提示）；语义面板顶部提示条显示「已选 N 个节点 · 点行尾 ⊕ 批量归属」；选中集合取 React Flow 多选（`node.selected`），回退 store 单选，排除组合内隐藏子节点 | `src/components/SemanticOrderList.tsx` + `src/components/SemanticPanel.tsx` |
| **样式** | `.mx-order-assign`（hover 转 accent、disabled 降透明度）、`.mx-bulk-hint` / `.active`（accent 描边提示条） | `src/styles/global.css` |
| **store 单测** | 新增 12 用例：批量生效且未选中节点不受影响、整批只占 1 条历史、undo 全集还原、`null` 清空 / 脱离、非法 id 静默且不留历史、重复 id 去重、演示锁定不动 | `src/store/__tests__/graphStore.bulkAssign.test.ts` |

### 验证

- **单元测试**：467 用例 / 49 文件全绿（新增 12）
- **类型检查**：`tsc` 干净
- **Lint**：0 error / 1 warning（既有 `EditableText`）
- **Format / 构建**：`format:check` 通过、`bun run build` 通过
- **预览**：dev server `http://127.0.0.1:5173/` 待人工确认

### 遗留

1. 批量归属暂未覆盖「取消归属」的一键入口（当前靠整批重新归属或逐个清空）
2. 组件层仍为 0 测试，本次交互改动依赖 store 层测试 + 人工预览
3. `syncActiveDoc` 与自动保存双写 documents、`MIRROR_FIELDS` 手工维护仍未处理

---

## 2026-10-18（日）发布 v0.4.0-next.4

- **版本号**：根 `package.json` 与 `mcp-server/package.json` 统一 `0.4.0-next.3` → **`0.4.0-next.4`**（tag `v0.4.0-next.4`）
- **随版本发布的内容**：
  - 🧭 **语义面板**：参与方与阶段的定义 / 顺序 / 删除收敛为唯一入口，属性栏「管理…」双向联动
  - **工具栏重排**：文件 → 历史 → 创建 → 整理 → 显示 → 面板 → 外观与保护
  - **大纲栏**：新增按阶段 / 按参与方分组
  - **键盘移动纳入历史栈**：连续微调 500ms 内合并为一次撤销
  - **CI 护栏**：新增 lint / format:check / build
- **README**：版本历史补 `next.3`（此前缺失）与 `next.4` 两行；头部与双线对照表版本号同步；参与方入口改为「🧭 语义」面板；测试基线 441/46 → 455/48
- **验证**：`format:check` 通过、lint 0 error / 1 warn、`tsc` + electron `tsc` 干净、455 用例 / 48 文件全绿、`bun run build` 通过
- **GitHub Release**：Pre-release 已发布 —— https://github.com/cosmosdeng/nodeflow/releases/tag/v0.4.0-next.4 ；安装包由 GitHub Actions(`release.yml`,on push tag `v*`)构建并上传,4 平台 **8 个资产**全绿(dmg ×2 / mac.zip ×2 / exe / win.zip / AppImage / deb)
- **npm 发布**：`@cosmosdeng/nodeflow-mcp@0.4.0-next.4` 已发布,`next` 与 `latest` 两个 dist-tag 均指向 `0.4.0-next.4`(该 npm 包只有 next 线、无 0.3.x stable 包,所以 `latest` 继续指向最新 prerelease)
- **发布流程要点**：npm 账号开启了 2FA(Auth & Writing),CLI 发布会被 `EOTP` 拦截;改用 **Automation token** 写入 `~/.npmrc` 后可绕过 2FA,后续发版无需 OTP

---

## 2026-10-18（日）工具栏编组 + 语义面板分工

把「参与方 / 阶段」从「散落在三处」收敛为「一个语义入口」,并给工具栏建立稳定的分组顺序。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **工具栏编组** | 按「文件 → 历史 → 创建 → 整理 → 显示 → 面板 → 外观与保护」重排:💬 注释从创建组移入显示组(与阶段带 / 参与方带同组);面板开关集中成组并右移;🔒 锁定全部并入外观与保护组 | `src/components/Toolbar.tsx` |
| **语义面板(新)** | `SemanticPanel.tsx` 取代 `ParticipantsPanel.tsx`,成为参与方与阶段的**唯一语义入口**:组织段 + 参与方段 + 阶段段,统一支持新增 / 改名 / 拖动排序 / 删除 / 定位 | `src/components/SemanticPanel.tsx` + `src/components/SemanticOrderList.tsx` |
| **大纲栏瘦身** | 移除参与方 / 阶段顺序段,回归「节点浏览与定位」;分组下拉新增「按阶段分组」「按参与方分组」;顶部提示语义入口位置 | `src/components/OutlinePanel.tsx` |
| **双向联动** | store 新增 `semanticFocus`(runtime-only、不持久化、不进文档镜像);属性栏「参与方 / 阶段」区块标题右侧「管理…」打开语义面板并聚焦对应项;语义面板点击行 → 画布定位并选中该语义下第一个节点 | `PropertiesPanel.tsx` + `App.tsx` + `store/types.ts` + `store/slices/structure.ts` |
| **排序组件复用** | 抽出 `SemanticOrderList`(拖动排序 + 双击改名 + 单击定位 + 可选删除 + 聚焦高亮),语义面板的参与方段与阶段段共用 | `src/components/SemanticOrderList.tsx` |

### 验证

- **类型检查**:`tsc` 干净
- **Lint**:0 error / 1 warning(既有 `EditableText`)
- **单元测试**:455 用例 / 48 文件全绿
- **构建**:`bun run build` 通过
- **预览**:dev server 已启动,`http://127.0.0.1:5173/` 待人工确认

### 遗留

1. 语义面板暂不支持「参与方 / 阶段批量归属节点」(当前为单节点赋值 + 排序)
2. 大纲栏分组选择不记忆,每次打开默认「平铺显示」
3. 组件层仍为 0 测试,本轮交互改动靠人工预览验证

---

## 2026-10-17（六）代码评审后的基线加固

承接对 `PROGRESS.md` 上一阶段的自查结论，补两块「新能力没被纳入体系」的缺口。

### 已完成

| 项 | 内容 | 模块 |
|---|---|---|
| **键盘移动纳入历史栈** | 方向键移动原直接调 `onNodesChange`，而历史快照只在 `handleNodeDragStart` 打点 → 键盘移动**无法撤销**。新增 store action `nudgeSelectedNodes(dx, dy, mergeWindowMs = 500)`：移动前 `markHistory()`，窗口内连续按键不分快照，「按住微调」一次 `Ctrl+Z` 回到移动前 | `src/store/slices/flow.ts` + `src/store/types.ts` + `src/App.tsx` + `src/store/runtimeFlags.ts` |
| **键盘微调单测** | 新增 6 用例：移动生效、`undo` 还原位置、窗口内连移只占 1 条历史、超窗口各记历史、无选中 / 演示锁定下不动且不留历史 | `src/store/__tests__/graphStore.nudge.test.ts` |
| **CI 补齐护栏** | `.github/workflows/ci.yml` 原只有 `tsc` ×2 + `vitest`，新增 `lint`（ESLint）、`format:check`（Prettier）、`build`（renderer + electron） | `.github/workflows/ci.yml` |
| **全仓格式化** | 补跑 `bun run format` —— 上一阶段改动后 22 个文件格式已漂移（正是 CI 缺 `format:check` 的后果） | 全仓 `src` / `electron` / `mcp-server/src` |

### 验证

- **单元测试**：455 用例 / 48 文件全绿（新增 6 用例）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **Lint**：0 error / 1 warning（`EditableText` 的 `set-state-in-effect`，合理用法保留）
- **Format**：`format:check` 全通过
- **构建**：`bun run build` 通过

### 遗留

1. **npm `latest` dist-tag 指向 prerelease** `0.4.0-next.3`（发布 stable `0.4.0` 时需修正，或明确 MCP 包只有 next 线）
2. **`syncActiveDoc` 与自动保存双写 documents**：每次 nodes 变化会重建 documents 两遍，订阅侧栏多一次渲染
3. **`MIRROR_FIELDS` 手工维护**：新增文档字段漏登记会静默不同步，缺镜像完整性断言
4. **组件层仍为 0 测试**：键盘连线（`L` 两步式）、DialogHost focus trap 等交互逻辑仍在组件 / `App.tsx` 内，未抽出可测单元

---

## 2026-10-17（六）路线图遗留项批量修复

### 已完成

接 `CODE_REVIEW.md` 路线图遗留项，完成 4 项：

| 项 | 内容 | 模块 |
|---|---|---|
| **friendly.ts 错误码** | `BRIDGE_UNAVAILABLE` 纳入 `AgentErrorCode` 枚举，去掉 `as unknown as AgentResponse` 断言 | `src/agent/types.ts` + `mcp-server/src/friendly.ts` |
| **ESLint + Prettier** | ESLint 9 flat config（typescript-eslint + react-hooks + prettier）；`.prettierrc` 匹配代码风格；`lint`/`format`/`format:check` 脚本；修复条件 Hook、render 期 ref 写入、`no-useless-assignment` 等 20 个 error | `eslint.config.js` + `.prettierrc` + 全仓格式化 |
| **edgePath 多障碍绕行** | 多个障碍命中时取并集包围盒统一绕行（原来只绕第一个命中） | `src/lib/edgePath.ts` |
| **layout 环处理 + 防爆栈** | 递归 DFS → Kahn 迭代 BFS；环上节点按弱连通分量同层；2000 节点深链不爆栈 | `src/lib/layout.ts` |
| **syncActiveDoc 细粒度同步** | 仅镜像字段引用变化时增量写入 documents，不再每次 set 全量重写 | `src/store/graphStore.ts` |

附带：`tsconfig` target/lib 升至 ES2022（`Error` cause 需要）；`agentBridge.ts` 错误保留 `cause` 链。

### 验证

- **单元测试**：449 用例 / 47 文件全绿（新增环层级、深链防爆栈、多障碍绕行 2 测）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **Lint**：0 error / 1 warning（`EditableText` 的 `set-state-in-effect`，合理用法保留）
- **构建**：`bun run build` 通过

### ESLint 存量 warning 清理（222 → 1）

- 批量清理冗余 import（184 个 unused specifier）：store 切片 god store 拆分遗留、类型导入
- 移除未用局部变量/函数/解构 selector（FlowCanvas 19 个、FlowNodeComponent 等）
- 修复 `exhaustive-deps`：FlowCanvas useCallback 补依赖、OutlinePanel 内联 `visibleCountOf`
- 修复无用 eslint-disable 指令
- 仅余 `EditableText` 的 `set-state-in-effect` warn（autoFocus→editing 模式切换，合理用法）

### 键盘 a11y + UI 文档同步

- **键盘移动**：方向键移动选中节点 10px，`Shift+方向键` 大步进 50px
- **键盘连线**：`L` 两步式（选源按 L → 选目标按 L），`Esc` 取消；连线模式悬浮提示
- **UI_UX_DESIGN.md 同步**：补录 §4.11 对话框（DialogHost）、EditableText ARIA、交互表新增键盘操作

### npm 发布（0.4.0-next.3）

- 发布 `@cosmosdeng/nodeflow-mcp@0.4.0-next.3`
- dist-tag 修正：`latest` → `0.4.0-next.3`，`next` → `0.4.0-next.3`
- **注意**：发布 stable `0.4.0` 时需将 `latest` 更新为 stable 版本

### 提交

| Commit | 内容 |
|---|---|
| `a18ea68` | fix(lint,algo,store): 路线图遗留项批量修复（错误码/ESLint/多障碍/环安全/增量同步） |
| `9e19258` | lint: warning 清理 222 → 1 |
| `74ac09e` | docs: PROGRESS 更新 |
| `ffdae47` | feat(a11y,docs): 键盘移动/连线 + UI_UX_DESIGN 同步 |
| `2b7b278` | docs: npm 发布记录 |

### 会话收尾

`CODE_REVIEW.md` 路线图**全部完成**：

| 路线图项 | 状态 |
|---|---|
| ~~拆 graphStore god store~~ | ✅ 早前完成 |
| ~~friendly.ts 错误码~~ | ✅ |
| ~~ESLint/Prettier~~ | ✅ |
| ~~edgePath 多障碍绕行 + layout 环处理~~ | ✅ |
| ~~syncActiveDoc 细粒度同步~~ | ✅ |
| ~~键盘连线/移动替代（a11y）~~ | ✅ |
| ~~npm latest dist-tag~~ | ✅ 发布 0.4.0-next.3 |
| ~~UI_UX_DESIGN.md 同步~~ | ✅ |

**测试基线**：449 用例 / 47 文件全绿，lint 0 error / 1 warn，`tsc` 干净，`build` 通过。

**遗留备注**：发布 stable `0.4.0` 时将 npm `latest` 更新为 stable。

### 遗留

**无**。路线图全部完成，仅备注：发布 stable `0.4.0` 时更新 npm `latest` dist-tag。

---

## 2026-10-17（二）god store 拆分

### 已完成

**拆分 `graphStore.ts`（3437 行 → 170 行 composer）**（提交 `623717d`）：

| 模块 | 行数 | 职责 |
|---|---|---|
| `store/types.ts` | 332 | FlowStore / Selection / AutoEditTarget |
| `store/persistence.ts` | 439 | 示例图、偏好、多文档 localStorage |
| `store/compositeHelpers.ts` | 434 | 塌缩/展开/隐藏刷新/端口重映射 |
| `store/historyHelpers.ts` | 107 | makeSnapshot / restoreSnapshotFields |
| `store/agentRevision.ts` | 80 | revision 指纹 |
| `store/runtimeFlags.ts` | 17 | 跨 action 运行时标志 |
| `store/slices/deps.ts` | 8 | SliceDeps 类型 |
| `store/slices/history.ts` | 73 | undo/redo/jumpTo |
| `store/slices/composite.ts` | 133 | 组合节点/标签 |
| `store/slices/edges.ts` | 270 | 端口/连线/产物 |
| `store/slices/nodes.ts` | 357 | 节点 CRUD/剪贴板/注释 |
| `store/slices/flow.ts` | 367 | RF changes/选中/主题/布局 |
| `store/slices/structure.ts` | 481 | Stage/参与方/排列/泳道 |
| `store/slices/documents.ts` | 539 | 多文档/存取/序列化 |
| `store/graphStore.ts` | **170** | composer + syncActiveDoc + 订阅 |

**对外 API 不变**：`useGraphStore` / `Selection` / `AutoEditTarget` 导出保持兼容。

### 验证

- **单元测试**：447 用例 / 47 文件全绿
- **类型检查**：`tsc` 干净
- **构建**：`bun run build` 通过
- **发布**：已推送 `origin/next`（`623717d`）

### 今日会话收尾

- 完整链路：代码评估 → P0/P1/P2 修复 → god store 拆分 → 文档 → GitHub
- **next 分支今日累计 5 个提交**已全部同步：
  - `b267fb4` fix(history,security)
  - `421f7ac` fix(test,perf)
  - `465ee38` feat(agent,ui)
  - `e66c837` docs: PROGRESS
  - `b9d2a37` docs: CODE_REVIEW
  - `623717d` refactor(store): god store 拆分
- 代理端口：本机 NinjaDesktop 当前 **7897**（历史记录为 7890）；push 用
  `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push`

### 遗留（接 `CODE_REVIEW.md` 路线图）

1. 键盘连线 / 移动替代（完整 a11y）
2. `friendly.ts` 错误码纳入 `AgentErrorCode` 枚举
3. `edgePath` 多障碍绕行；`layout` 环处理
4. ESLint/Prettier；`.mcp.json` 清理
5. npm `latest` dist-tag 指向 stable
6. `syncActiveDoc` 细粒度同步（当前整份 documents 回写）

---

## 2026-10-17

### 背景

对 `next` 分支做了一轮完整代码评估（架构 / 质量 / 安全 / 工程化），随后按 P0 → P1 → P2 修复并推送到 GitHub。

评估结论摘要：领域建模与 Agent/MCP 协议设计成熟；主要风险在 **jumpTo 快照丢字段、Agent Bridge 无鉴权、无 CI、god store**。完整评估见 [`docs/CODE_REVIEW.md`](./CODE_REVIEW.md)。

### 已完成

#### P0（阻塞级）

| 项 | 内容 | 提交 |
|---|---|---|
| jumpTo 丢数据 | 抽出 `makeSnapshot` / `restoreSnapshotFields`，`markHistory`/`undo`/`redo`/`jumpTo` 四处共用；补全 participants / organizations / participantOrder / participantOrderMode / stageOrder / arrangePending | `b267fb4` |
| Agent Bridge 安全 | 强制共享 token（`~/.nodeflow/agent-bridge.json` 0600）；Host 校验防 DNS rebinding；Origin 校验防 CSRF；`X-NodeFlow-Agent: 1` 头；`openExternal` 仅 http(s)；IPC sender 校验；requestId 冲突拒绝 | `b267fb4` |
| CI | `.github/workflows/ci.yml`：`tsc` + `tsc.electron` + `vitest`，PR/push 到 main/next 触发 | `b267fb4` |

#### P1

| 项 | 内容 | 提交 |
|---|---|---|
| edgePath 采样 bug | React Flow 输出紧凑格式 `M0 0L20 0`（命令后无空格），旧正则要求 `\s+` 导致**绕障检测完全失效**。重写 tokenizer，兼容科学计数法 | `421f7ac` |
| 测试补齐 | `edgePath` 8 测 + `exportSvg` 9 测；`jumpTo` 5 测；bridgeAuth 12 测 | `b267fb4` `421f7ac` |
| validateGraph 接入 | `loadProject` / `loadGraph` 语义校验 warn 不阻断（不再死代码） | `421f7ac` |
| 版本统一 | 根 / mcp-server / stdio / cli 全部 `0.4.0-next.3`，从 `package.json` 单一来源读取；`versionSync` 测试锁定 | `421f7ac` |
| 细粒度订阅 | 非组合节点不订 `nodes`/`edges`；注释按 id 过滤；连线障碍 `useShallow` 几何比较 | `421f7ac` |

#### P2

| 项 | 内容 | 提交 |
|---|---|---|
| assert schema 对齐 | 补 `nodeIds` / `expected` / `expectedParticipantIds` / `expectedStageIds`；`update_participant` 传 `organizationId` | `421f7ac` |
| expectedRevision | 乐观并发：mutation 带 `expectedRevision` 时 revision 不匹配返回 `REVISION_CONFLICT` 且不改状态；查询不受影响 | `465ee38` |
| 错误模型 | assert 失败统一 `isError`；失败详情不再回显完整 payload | `465ee38` |
| 死代码清理 | 删 `LEGACY_STAGE`/`LEGACY_SWIMLANE` 死 JSX、`StageComponent.tsx`、Toolbar 泳道隐藏分支；spikes 加 README（仅测试引用） | `465ee38` |
| 对话框统一 | 全局 `DialogHost` + Promise `confirm/alert`；App/Toolbar/PropertiesPanel/closeProject 共 13 处原生 `alert`/`confirm` 全部替换 | `465ee38` |
| a11y 基线 | `EditableText` 加 `role="textbox"`/`aria-*`/`tabIndex`；对话框 focus trap + 自动聚焦 | `465ee38` |

### 验证

- **单元测试**：447 用例 / 47 文件全绿（评估前约 406 / 42）
- **类型检查**：`tsc` + `tsc -p tsconfig.electron.json` 干净
- **构建**：`bun run build` 通过
- **发布**：10 个提交已推送 `origin/next`（含此前 7 个未推提交）

### 遗留 / 下一步

1. **拆 `graphStore.ts`（3430 行 god store）** —— 收益大但回归面广，建议单独 PR + 先补 store 测试
2. **键盘连线 / 移动替代**（a11y）—— 需要交互设计决策
3. **npm dist-tag**：`latest` 仍指向 prerelease `0.4.0-next.2`，发布时需 `npm dist-tag add @cosmosdeng/nodeflow-mcp@0.4.0-next.3 latest` 或改用 `@next`
4. **Agent Bridge 默认策略**：当前仍默认启动但强制 token；若需默认关闭，改 `main.ts` 的 `NODEFLOW_AGENT_BRIDGE` 判断
5. ~~**`docs/CODE_REVIEW.md`**~~：✅ 已落盘（2026-10-17）

### 环境备注

- 本机 git 代理 `127.0.0.1:7890` 当日未启动，直连推送成功；若 pull/push 失败先启动 NinjaDesktop
