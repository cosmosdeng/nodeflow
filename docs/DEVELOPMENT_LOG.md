# DEVELOPMENT_LOG.md — 开发日志

> 按时间倒序记录开发历程。新功能、重要修复、里程碑都应在此追加。

## 2026-10-28 · 组件层测试补齐:剩余 7 个组件(完成)

继上一轮 10 个组件后,把剩下未覆盖的组件一并补齐,**组件层 0 测试的状态彻底结束**。

- **新增用例(79 个 / 6 文件)**:
  - SemanticOrderList(15):受控双向联动——渲染 / 编辑改名(空值与同值不提交、Escape 取消、`未分配` 虚拟行禁改)/ **拖拽重排**(自建 `getData`/`setData` 的 DataTransfer 替身)/ ⊕ 批量归属 / activeId 高亮。
  - ContextMenu(9):`---` 分隔符不是按钮、disabled / danger、**点击顺序为先关菜单再执行 onClick**、Escape 与点击别处关闭、菜单内部 pointerdown 不被误判为「点击别处」。
  - ConfirmDialog + DialogHost(13):按钮文案与 danger、取消三种触发(按钮 / 遮罩 / Esc)、alert 无取消按钮;`confirmDialogAsync` → 点确认 → **Promise resolve true/false** 的完整异步链路(需 `await act`)。
  - MatrixVisualLayer(12):两轴显示开关互斥组合、尺寸为 0 时空壳、语义再指派高亮、名称缺失回落「未命名阶段 / 未命名参与方」,以及**双击标签改名**(window 捕获阶段 + 坐标命中表)落到 `updateStage` / `updateParticipant`。
  - CompositePopupView(7):localStorage 快照读取、**损坏 JSON / 结构非法均回落空态不崩**、storage 事件热刷新、多 id 各自独立。
  - SemanticPanel(13):三个小节与空态、添加参与方 / 组织(输入为空时按钮禁用)、新增阶段域、删除走确认后生效、批量归属与一键清空。
  - Toolbar 补(11→21):文件菜单两层展开、**新建 / 清空画布的确认 → 取消双路径**、导入导出二级菜单(JSON / JPG / PDF / 幅面)、保存项目走 `serializeProject` 下载。
- **基建再补**:`src/test/setup.ts` 增加 **`URL.createObjectURL` 占位实现** —— 保存项目 / 导出流程会 `new Blob` 后建 Blob URL,测试环境的实现不兼容,抛出未捕获异常污染整轮运行(表现为「用例全过但退出码非 0」)。
- **测试**:650 用例 / 66 文件全绿且无未处理错误;tsc / lint(0 error)/ format / build 全过。

---

## 2026-10-27 · 组件层测试落地(RTL + jsdom)(完成)

此前组件层 **0 测试**(500 用例全部是纯逻辑 / store)。本轮补齐基建与 10 个组件的冒烟 + 交互用例。

- **基建**:新增 `vitest.config.mts`,用 **projects 分环境**——`logic` 沿用 node 环境跑全部 `.test.ts`(保持原速度),`components` 用 jsdom 跑 `.test.tsx` 并加载 setup;新增依赖 `jsdom` / `@testing-library/react` / `@testing-library/jest-dom`。
- **`src/test/setup.ts`(React Flow 测试配方)**:
  - `ResizeObserver` 在 `observe` 时**立即以固定尺寸回调** —— 否则 RF 永远等不到节点测量完成(`nodesInitialized` 恒 false),**连线与端口位置一律不渲染**;
  - 原型覆盖 `offsetWidth / offsetHeight`(jsdom 恒返回 0,RF 靠它量节点);
  - `DOMMatrixReadOnly`、`getBoundingClientRect`、`getBBox`、`scrollIntoView`;
  - **`innerText` 映射到 `textContent`** —— jsdom 完全未实现 innerText,而 `EditableText` 依赖它读写内容。
- **覆盖**:EditableText(9) / PropertiesPanel(9) / Toolbar(11) / OutlinePanel(7) / HistoryPanel(6) / AnnotationBox + ActorIcon(8) / FlowNodeComponent(8) / FlowEdgeComponent(7) / FlowCanvas(6)。
- **测试策略**:组件层只验证「交互 → 调用 action」——用 `useGraphStore.setState` 把 action 换成 spy、用完恢复;store 的真实行为交给 store 层用例,避免重复覆盖。**渲染后再 setState 必须用 `act` 包裹**,否则组件尚未重渲染就点击。
- **顺带修复**:`OutlinePanel` 搜索直接对 `description` 调 `toLowerCase()`,旧项目 JSON 导入时该字段可能缺失导致整块崩溃 → 加 `?? ''` 兜底并补回归用例。
- **测试**:571 用例 / 60 文件全绿;tsc / lint / format / build 全过。

---

## 2026-10-27 · 连线「扭弯」根治:控制臂严格沿端口法线延伸(完成)

用户两张截图定位到两类扭弯:①连线到达 target 时从节点顶部掠下来进侧端口;②连线从 source 出来后向左拐出反向 S 形大弯。根因:旧版(含 React Flow `getBezierPath`)控制点按 dx/dy **轴向比例**取值——控制臂可以指向端口法线的反方向,曲线从端口出发没走出多远就贴着节点拐弯。

- **新增 `portNormal(pos)`**:端口外法线单位向量(Right→+x、Left→-x、Top→-y、Bottom→+y)。
- **新增 `buildNativeBezier` 替换 `getBezierPath`**:控制臂严格沿两端端口法线延伸 `e=max(min(60,dist*0.5), dist*0.45)`——曲线先从端口沿法线「走出去」再圆滑弯向对方,出口/进入段都落在节点外 0°~180° 扇形内;末段恒从端口法线侧进入(不再从节点顶部拐下)。
- **`buildBezierAvoiding` 改造**:签名补 sourcePosition/targetPosition;控制臂沿法线延伸 `e=max(24,dist*0.35)`,拱出量 bend 只作为垂直偏移叠加——旧版 `c1.x=dx*0.35` 在 target 位于法线反方向时会往回翘(截图 S 形弯的直接来源),新版出口恒合规。
- **测试**:500 用例 / 51 文件全绿,新增 3 用例(Right 端口绕障控制臂沿法线、Bottom→Left 出入沿法线、长斜跨沿法线进入);tsc/lint/build 通过。

---

## 2026-10-27 · 连线渲染两条新规则:覆盖节点 + 端口出口 0°~180° 扇形约束(完成)

- **规则一「连线永远覆盖在节点上面」**:CSS 把 `.react-flow__edges` z-index(0→1)提到 `.react-flow__nodes`(1→0)之上,连线始终绘制在节点上层;同时 edges 层 `pointer-events:none` + edge `visibleStroke`,让连线的空白区穿透,节点仍可点击/拖拽/框选。

- **规则二「从端点出来必须在节点外 0°~180° 扇形往外走,不得扭进节点内部」**:`edgePath.ts` 新增 `portExitOk(fromX,fromY,fromPos,path,fromEnd)`,以端口边中点为顶点、节点外法线为中心,要求初段方向落在合法半平面(Right→vx≥0、Left→vx≤0、Top→vy≤0、Bottom→vy≥0);`computeEdgePath` 对绕障路径(bezier + smooth)同时校验 source 与 target 两端,任一违规即**回退原生路径**(原生由 React Flow 生成,端口沿节点外法线出发,天然合规)。
- **关键坑**:`sampleSvgPath` 的 samples[0] 恒为端口起点自身(位移 0)→ 用 index 1;target 端用 samples[len-2] 避开终点自身,否则恒判合规、约束失效。
- **测试**:498 用例 / 51 文件全绿,新增 2 用例(Right 端口违规回退 native + 合规绕障不误伤);tsc/lint/build 通过。

- **补强(同日追加)**:守门扩展到**所有最终路径**(含原生)。原先规则二只校验绕障路径,原生路径(无障碍直返 / 绕障失败回退)完全不校验 —— 若原生 bezier 在端口背对背等极端几何下折返钻进节点,规则即失效。现 `computeEdgePath` 统一:先算 candidate(绕障合规则用绕障,否则原生),返回前**统一守门**双端出口方向;违规则兜底改成 smoothstep(沿端口法线直行再拐弯,出口恒在合法半平面)。已无更合规解时原样返回,不无限兜底。

---

## 2026-10-27 · 自动排列:加大矩阵间距 + 连线感知列缝隙(完成)

- **背景**:用户反馈「自动排列后连线避让过于激进」;希望从排列源头优化——合理分布节点间距,避免端点挨太紧导致连线大弧避让,同时连线重叠最小化、避让努力最小化。
- **修复** `computeMatrixGridGeometry`:① 加大基础间距(列 120→150、行 80→104、堆叠 40→54、层 60→78);② 列缝隙连线感知——相邻列每多一条跨列连线 +12px(上限 +96)。
- **效果**:节点更疏朗、端点间距拉开,连线直出直进空间充足,减少大弧避让与重叠。
- **测试**:496 用例 / 51 文件全绿,新增「跨列连线加宽列缝隙」用例;同步更新 5 处硬编码旧间距的测试。
- 遗留:连线感知仅覆盖 assigned 跨列连线;smoothstep 直角线绕障仍未设上限。

---

## 2026-10-27 · 连线改为「温和避让」:巨障紧贴端口时放弃绕障盖上节点(完成)

- **现象**:连线避开节点时过于激进——两个节点挨得很近时,连接在端口上的连线为避让旁边节点,从几乎法线方向往外拱出巨大弧线。
- **设计取向**:不需要完全避让,只需温和避让;节点很近时宁可盖过节点,也不要激进出大弯。
- **修复**:`buildBezierAvoiding` 的 `bend` 若超过「端口间距一半」(`maxBend = max(40, span)`)仍无法避开 → 返回 `null`;`computeEdgePath` 对 bezier 绕障失败回退到原生路径。附近有空间就轻轻一拱绕开,挤在一起就盖上节点。
- **测试**:新增 2 用例(远离端口的障碍仍绕开 + 巨障贴两边时放弃绕障回退原生);495 用例 / 51 文件全绿。
- 已推 `aa0a24a..5d0803f`。

---

## 2026-10-27 · 绕障弧线「拱太远」:改采样驱动最小外推量(完成)

- **现象**:连线避开节点时拱得太远、视觉过于激进。
- **根因**:`buildBezierAvoiding` 的 `bend` 初始值直接用「绕行通道坐标」估算(障碍边 + padding + 40 margin = 外扩 64px),且循环只增不减,曲线永远贴不回障碍。
- **修复**:改采样驱动 —— `bend` 从 24 起步,采样校验,压到障碍(带 padding)才 ×1.3,直到「刚好」避开;曲线贴着障碍走,只拱到避障所需最小高度。
- **测试**:新增 1 用例(|labelY| ∈ (60,120),既绕过障碍半高又不越界);493 用例 / 51 文件全绿。
- **遗留**:多障碍仍是 union 并集包围盒绕行,分散障碍时并集较大;逐个绕行待确认。

---

## 2026-10-27 · 自动排列乱套:锁定节点被排列搬走(完成)

- **现象**:排列后带内节点其实已按矩阵落位,但带外散落一批节点(都有 🔒),底部出现巨大弧线。
- **根因**:排列链路(structure/arrange/matrixClassification/freePlacement)对 `locked` **零处理** —— 锁定语义是「不可拖动」(FlowCanvas 以 draggable=false 拦截),排列却把锁定节点随意搬到矩阵/拓扑位置,与其它节点距离拉远 → 「乱套」。
- **修复**:三条排列路径(runArrange / runSmartArrange 双路径 / autoLayout)统一在布局输入剔除 `data.locked` 节点 —— 它们不产生目标位置,写回时自然保留原位。
- **测试**:新增 2 用例(矩阵/legacy:锁定节点位置不变、其余照常排);492 用例 / 51 文件全绿。
- **遗留**:未挂语义的 free 节点「保持原位」是冻结设计,语义稀薄时排列效果有限;锁定节点不为其它节点让位可能重叠 —— 均待用户拍板是否进一步改进。

---

## 2026-10-27 · 修复连线断开(绕障 bezier 拼接吞掉后半段)

- **现象**:多条弧线终点悬空、不落在端口上,网关分支彩色线尤其明显。
- **根因**:`buildBezierAvoiding` 拼接两段贝塞尔时用 `/^M[^L]*L?/` 删第二段开头的 M,但 `getBezierPath` 输出(`M0,0 C150,0 150,200 300,200`)不含 L 命令,`[^L]*` 把第二段整段吞光 → 路径只剩「source → 绕行中点」,终点悬空。
- **溯源**:`git log -S` 显示该正则自 v0.1.0 P2(`cd93263`)就有 —— 老 bug,画布复杂化 + `421f7ac` 的采样检测后才大量触发。测试此前只断言「含 C / 有偏移」,没断言终点坐标,所以一直漏网。
- **修复**:正则改为 `/^M[-\d.,\s]+/`(只吃 M + 数字坐标,停在 C 前);补 2 个回归用例断言绕障路径末尾坐标 = target。
- 验证:480 用例 / 50 文件全绿;tsc / lint / format / build 均通过。
- **经验**:路径类纯函数的测试必须校验首尾坐标;「包含某命令」的断言挡不住结构性截断。

---

## 2026-10-27 · 连线「很奇怪」的真凶:绕障判定 100% 触发(完成)

- **现象**:修完中点拐角后弧线仍全被拱成大弯。
- **根因**:`collectEdgeObstacles` 只排除 source、**保留 target**,而连线终点必然落在 target 矩形(外扩 padding)内 → 命中判定恒成立 → **每条线都走绕障**。把 target 当障碍原是为了让标签不压在 target 上,代价是所有线失去自然形态;此前修的「终点悬空 / 中点拐角」都只是绕障路径内部的问题。
- **修复**:绕障只为「穿过第三者节点」触发 —— `collectEdgeObstacles(nodes, sourceId, targetId?, fallback?)` 同时排除两端;组件传 `target`;控制点外推系数 1.6 → 1.35(曲线在 t=0.5 的偏移是 0.75·bend,1.35 倍刚好落在绕行通道)。
- **测试**:新增 3 用例,其中一条集成断言沿真实调用链 `collectEdgeObstacles → computeEdgePath`:无第三者时必须**等于原生路径**。
- **经验**:视觉增强要能证明「只在需要时触发」。触发条件若必然成立(终点落在目标内),功能就从「偶尔绕一下」退化成「永远在绕」,且因路径本身不报错,只有肉眼可见 —— 必须配一条反向断言。
- 验证:485 用例 / 50 文件全绿;tsc / lint / format / build 均通过。

---

## 2026-10-27 · 绕障弧线中点拐角:改单段三次贝塞尔(完成)

- **现象**:拐角正好落在线中点 —— 也就是连线说明 / 产物 chip 所在处。
- **根因**:弧线绕障是「source→绕行中点」+「绕行中点→target」两段贝塞尔拼接,两段的切线方向由 handle 朝向(midIn/midOut)决定,且被设成与 S→T 主方向垂直,与实际进出方向不一致 → 拼接处 G1 不连续,必然有可见拐角;label 又恰好取该中点,于是拐角贴在标签旁。
- **修复**:改为**单段三次贝塞尔** —— 控制点沿绕行侧外推(`c1 = source + 0.35·主方向 + bend·绕行方向`),整条曲线 C1 连续;用现有 `sampleSvgPath` 采样校验,仍压到障碍就把 bend ×1.35 重试(上限 1200);标签改取曲线参数中点 t=0.5。
- **测试**:新增 3 用例 —— 单段性(M/C 各 1 次)、相邻切线夹角 < 90°、采样不压障碍且标签落在绕行段。483 用例 / 50 文件全绿。
- **经验**:曲线的「平滑」是可断言的:采样后检查相邻切线夹角,比肉眼看截图可靠。

---

## 2026-10-27 · 修复预览白屏(连线绕障 selector 无限重渲染)

- **现象**:预览页 `#root` 为空、整页白屏;dev server 无报错,`tsc` / lint / 全部单测通过。
- **定位**:无头 Chrome 抓 console 得到 `The result of getSnapshot should be cached to avoid an infinite loop` + `Maximum update depth exceeded`,错误发生在 `<FlowEdgeComponent>`。
- **根因**:障碍物 selector 用 `useShallow` 包裹,但返回的是**每次新建的对象数组**(`rects.push({x,y,width,height})`)。`useShallow` 只浅比较一层,元素引用每次都变 → 快照恒不相等 → 无限重渲染 → React 卸载整棵树。
- **修复**:只订阅稳定的 `s.nodes`,用 `useMemo` + 新抽出的纯函数 `collectEdgeObstacles`(`src/lib/edgePath.ts`)派生;顺带补 5 个单测(`src/lib/__tests__/edgeObstacles.test.ts`)锁住「排除 source / hidden、尺寸回落」等规则。
- **经验**:zustand selector 内禁止造新对象/新数组元素;`useShallow` 只适合「元素引用稳定」的数组。另:这类 bug 只有真实渲染才暴露,组件层 0 测试的代价开始显现。
- 验证:页面 DOM 正常、无 console 错误;478 用例 / 50 文件全绿;`tsc` / lint / format / build 均通过。

---

## 2026-10-27 · 批量取消归属 + 幂等短路(完成)

- **补上「减」的方向**:10-21 的批量归属只能加不能减。语义面板提示条右侧新增「⊘ 清参与方」「⊘ 脱阶段」,复用 `assignParticipantToMany(ids, null)` / `assignStageToMany(ids, null)`,整批仍是一次历史、一次撤销。
- **幂等短路(重要)**:两个批量 action 先比对「目标状态 vs 现状」,一致就直接 return —— 否则重复点 `⊕`、对本来就没归属的节点点 `⊘`,都会写一条内容无变化的快照,用户 `Ctrl+Z` 会看到「撤销了但画面一动不动」。这是把上次「单次历史」思路补完:不仅要「一次撤销还原一批」,还要「无变化不占撤销步」。
- **测试**:`graphStore.bulkAssign.test.ts` 12 → 18 用例,新增幂等短路不写历史、批量取消单次历史可撤销、全未归属时取消不写历史、先归属再取消两条历史逐次还原、阶段批量脱离与幂等。
- 验证:473 用例 / 49 文件全绿;`tsc` 干净;lint 0 error / 1 warn;`format:check` 与 `build` 通过。

---

## 2026-10-21 · 语义面板批量归属(完成)

- **动机**:v0.4.0-next.4 里语义面板解决了「在哪管理参与方 / 阶段」,但赋值仍是逐节点的 —— 给 20 个节点指定同一参与方要在属性栏重复 20 次。
- **store 层**:新增 `assignParticipantToMany(nodeIds, participantId)` 与 `assignStageToMany(nodeIds, stageId)`(`src/store/slices/structure.ts`)。要点是**整批只调一次 `markHistory()`**,所以这看似 UI 层的糖其实必须落在 store:逐节点调用现有的 `assignParticipant` / `assignNodeStage` 会写 N 条历史,撤销要按 N 次。阶段沿用单归属语义(先 `detachNodeIdsFromStages` 再逐个 `addNodeToStage`)。非法 id / 空列表 / 演示锁定一律静默返回且不记历史。
- **UI 层**:`SemanticOrderList` 行尾加 `⊕`(无选中节点时 disabled + tooltip 说明),语义面板顶部提示条显示「已选 N 个节点」。选中集合优先 React Flow 多选(`node.selected`),回退 store 单选,并排除组合内已隐藏的子节点(避免改到看不见的东西)。
- **测试**:`graphStore.bulkAssign.test.ts` 12 用例 —— 批量生效且未选中节点不受影响、整批只占 1 条历史、undo 全集还原、`null` 清空 / 脱离、非法 id 静默且不留历史、重复 id 去重、演示锁定不动。
- 验证:467 用例 / 49 文件全绿;`tsc` 干净;lint 0 error / 1 warn;`format:check` 与 `build` 通过。
- 遗留:暂无「取消归属」的一键入口;组件层仍 0 测试,本次改动靠 store 测试 + 人工预览兜底。

---

## 2026-10-18 · 发布 v0.4.0-next.4(完成)

- **版本号**:根 `package.json` 与 `mcp-server/package.json` 统一 → `0.4.0-next.4`,tag `v0.4.0-next.4`,提交 `chore(release): prepare v0.4.0-next.4`(`aa78641`)。
- **GitHub Release**:Pre-release 已发布,安装包改为**在 GitHub Actions 上构建**(`release.yml`,on push tag `v*`):mac arm64 / mac x64 / linux / win 四个 job 全绿,`Publish GitHub Release` 上传 8 个资产(dmg ×2、mac.zip ×2、exe、win.zip、AppImage、deb)。手写的发布说明被保留(未被 `generate_release_notes` 覆盖)。
- **npm**:`@cosmosdeng/nodeflow-mcp@0.4.0-next.4` 已发布,`next` 与 `latest` 两个 dist-tag 均指向 `0.4.0-next.4`。该包只有 next 线(npm 上仅有 next.2 / next.3 / next.4,无 0.3.x),所以 `latest` 继续指向最新 prerelease。
- **踩坑**:npm 账号开启了 2FA(Auth & Writing),`npm publish` 被 `EOTP` 拦截;CLI 的 `--otp` 需要认证器动态码,改用 **Automation token**(写入 `~/.npmrc` 的 `//registry.npmjs.org/:_authToken`)可绕过 2FA,后续发版无需 OTP。
- **README**:版本历史补 `next.3`(此前漏记)与 `next.4` 两行;头部与双线对照表版本号同步;参与方入口改为「🧭 语义」面板;测试基线 441/46 → 455/48。

---

## 2026-10-18 · 工具栏编组 + 语义面板分工(完成)

- **工具栏重排**:按「文件 → 历史(撤销/重做)→ 创建(＋节点 / ▦阶段域 / ⧉组合)→ 整理(⤺自动排列)→ 显示(💬注释 / ▮阶段带 / ▬参与方带)→ 面板(🗂大纲 / 🧭语义 / ⚙属性 / 🕘历史)→ 外观与保护(连线风格 / 主题 / 🔒锁定全部)」重排。💬 注释原在「创建」组,语义上属于显示开关,移入「显示」组;面板开关集中成组并右移,与画布操作分离。
- **语义面板(新)**:`SemanticPanel.tsx` 取代 `ParticipantsPanel.tsx`,成为参与方与阶段的**唯一语义入口** —— 组织段(新增/改名/删除)+ 参与方段(新增/改名/拖动排序/删除/定位)+ 阶段段(新增阶段域/改名/排序/删除/定位)。
- **大纲栏瘦身**:移除参与方 / 阶段顺序段(迁移至语义面板),回归「节点浏览与定位」;分组下拉新增「按阶段分组」「按参与方分组」,使语义结构仍可在大纲中浏览;顶部提示语义入口位置。
- **双向联动**:store 新增 `semanticFocus`(runtime-only,不持久化、不进文档镜像);属性栏「参与方 / 阶段」区块标题右侧「管理…」→ 打开语义面板并聚焦当前节点对应语义项(accent 高亮);语义面板点击行 → 画布定位并选中该语义下第一个节点。
- **组件抽取**:`SemanticOrderList.tsx`(原 `OutlinePanel` 内的 `OrderRowList`)抽为共享组件,新增单击定位、聚焦高亮、可选删除,参与方段与阶段段共用。
- 验证:`tsc` 干净;lint 0 error / 1 warn;455 测试 / 48 文件全绿;`bun run build` 通过;dev server 预览待人工确认。
- 遗留:语义面板暂不支持批量归属;大纲分组选择不记忆;组件层仍 0 测试。

---

## 2026-10-17 · 键盘微调历史栈 + CI 护栏(完成)

- **键盘移动可撤销**:方向键移动原在 `App.tsx` 内直接调 `onNodesChange`,而历史快照只在 `FlowCanvas` 的 `handleNodeDragStart` 打点,导致键盘移动**无法 Ctrl+Z 还原**。新增 store action `nudgeSelectedNodes(dx, dy, mergeWindowMs = 500)`(`src/store/slices/flow.ts`):移动前 `markHistory()`,500ms 窗口内连续按键不分快照,「按住微调」一次撤销回到移动前;`App.tsx` 方向键分支改走该 action。合并窗口时间戳存于 `src/store/runtimeFlags.ts`(不进 state、不持久化)。
- **新增单测**:`src/store/__tests__/graphStore.nudge.test.ts` 6 用例 —— 移动生效、`undo` 还原位置、窗口内连移只占 1 条历史、超窗口各记历史、无选中 / 演示锁定下不动且不留历史。
- **CI 补齐护栏**:`.github/workflows/ci.yml` 原仅 `tsc` ×2 + `vitest`,新增 `lint`(ESLint)、`format:check`(Prettier)、`build`(renderer + electron)。
- **全仓格式化**:补跑 `bun run format` —— 上一阶段改动后 22 个文件格式已漂移,正是 CI 缺 `format:check` 的直接后果。
- 验证:455 测试 / 48 文件全绿;`tsc` + electron `tsc` 干净;lint 0 error / 1 warn;`format:check` 全通过;`bun run build` 通过。
- 遗留:npm `latest` 仍指向 prerelease `0.4.0-next.3`;`syncActiveDoc` 与自动保存双写 documents;`MIRROR_FIELDS` 手工维护;组件层仍 0 测试。

---

## 2026-08-26 · 泳道坐标修复 + 阶段域注释(完成)

- **泳道显示修复**:修复两个坐标 bug——`computeSwimlaneBounds` 误把 viewport 平移当原点(改为固定流坐标起点 START_X/START_Y)、FlowCanvas 渲染转换方向错误(`(lane.x - viewport.x)*zoom` 应为 `lane.x*zoom + viewport.x`,与 StageComponent 一致)。修复后参与方对应的泳道正常显示(空 lane 显示最小高度带)。
- **阶段域支持注释**:`AnnotationTarget` 新增 `{kind:'stage', stageId}`;`lib/annotation.ts` 支持 stage 归属判定 + 去重(一个主体一条注释);`graphStore.deleteStage` 清理指向该阶段的注释;`StageComponent` hover 显示 `📌` 注释按钮(参照节点交互);`FlowCanvas` 在 annotation-layer 渲染 stage 归属注释(定位在域框下方)。新增 `annotation.test.ts` stage 用例。
- 验证:167 测试通过;tsc / build 通过;已推送 origin/main。

---

## 2026-08-25 · F1-02 Participant & Swimlane 实施(完成)

在 F1-01 v3 冻结设计基础上,按 A~G 安全递增实施 Participant / Organization / Swimlane。
- **F1-02A Domain Model**:`ParticipantType`/`Participant`/`Organization` 类型 + `FlowNodeData.participantId`;`lib/participant.ts` 纯逻辑(validateParticipants / resolveParticipant / detachParticipantFromNodes / detachOrganizationFromParticipants / organizationOf / isAssignedTo)。graphStore 顶层 state + documents + history + persistence 同步。
- **F1-02B Persistence/Migration**:`CURRENT_PROJECT_VERSION` 3→4;`serializeProject` 输出 v4(`document` 含 participants/organizations);`buildProjectDocumentV4`(保存侧清洗);`migrateProjectV3ToDocument`(v3→v4,participants 迁移为空);`loadProject` 分流(v3 legacy→migrateV3 / v2 legacy→migrateV2 / v4 current);Future Gate 保持(>4 拒绝)。
- **F1-02C Outliner**:`ParticipantsPanel`(组织树 + 参与方新增/编辑/删除 + 未分配分组);Toolbar「👤 参与方」开关。
- **F1-02D Assign**:`assignParticipant`(显式 Assign,只改 participantId 不改 position,atomic undo);PropertiesPanel 参与方下拉。
- **F1-02E Optional Swimlane**:`lib/arrange.ts` `computeSwimlaneBounds`(derived bounds,不持久化);`swimlaneEnabled`/`toggleSwimlane`(纯展示开关,不改 graph/position/participant);FlowCanvas swimlane-layer 渲染。
- **F1-02F Arrange**:`arrangeSwimlanes` 纯函数(只移动有 participant 的 node,不改 participantId/stage membership/edge semantics,deterministic);`arrangeAllSwimlanes`(单 undo,不 autoGrowStage/global layout);Toolbar「⇣ 整理泳道」。
- **F1-02G Integration**:`graphStore.participant.test.ts` 7 行为测试(Assign/Drag/Delete/Arrange/Stage/Composite/Gateway invariant)。

验证:
- ✅ tsc 通过
- ✅ **166 测试全部通过**(159 + 7 行为测试)
- ✅ build 通过
- ✅ 无 lint 错误
- ✅ 未新增架构层(仅 lib/participant.ts + lib/arrange.ts 纯函数);未建 laneId 持久化绑定;Manual drag 不隐式改 participant;Arrange 不触发 autoGrowStage/global layout
- ✅ dev server + preview 正常运行

---

## 2026-08-25 · P6-04~07 Architecture Hardening 实施(完成)

在 P6 设计(只读)基础上完成 Compatibility Foundation + Migration + Version Gate + Validation + Persistence Safety 实施。
- **新增 `src/lib/document.ts`**(纯逻辑兼容层,无 React/Zustand/React Flow 依赖):
  - `detectDocumentFormat`:Format+Version 共同识别(Project v3 / Export / Legacy Project v2 / Legacy Export v1 / unknown / future)
  - `migrateProjectV2ToDocument`:Legacy Project v2 → 当前文档(剥离历史/脏标记/React Flow 字段;deterministic / non-mutating)
  - `importLegacyExportToDocument`:Legacy Export v1 → 当前文档(Export Import/Conversion,非 Project Migration)
  - `validateDocumentData`:最小结构校验(nodes/edges/viewport/annotations/stages)
  - `buildProjectDocumentV3`:保存侧构建 v3 正式格式(清洗 selected/measured/hidden/draggable;不含 history)
- **`serializeProject` 升级为 Project Format v3**:`{format:'nodeflow', version:3, exportedAt, document:{name,color,graph:{nodes,edges,annotations,stages},editor:{viewport,activeTabId,compositeTabs}}}`
- **`loadProject` 接入兼容层**:Format Detection → Future Version Gate(version>3 安全拒绝+明确提示) → Migration/Import/Current 分流 → Current Validation → Runtime Hydration(生成新 doc id,history 从空开始)
- **新增 `loadError` 状态**:加载失败时给出用户可见的明确错误(Toolbar/App 展示),不再笼统"无法解析"
- **localStorage 增量版本化**:persistDocument 写入 `{version:1,...}`;loadPersistedDocument 兼容无 version 的 legacy 数据
- 新增测试 `src/lib/__tests__/document.test.ts`(14 用例:format detection / future gate / migration determinism & non-mutation / export import / validation)

验证:
- ✅ tsc 通过
- ✅ **143 测试全部通过**(129 + 14 document)
- ✅ build 通过
- ✅ 无 lint 错误
- ✅ 未新增架构层(仅纯函数模块);未改 UI/产品行为/React Flow/Zustand

---

## 2026-08-25 · P6 系列 Document Format & Persistence 设计(完成,只读)

进入 P6(文档格式与持久化)。P6-01~P6-03 为**只读审计 / 设计**阶段,未修改任何代码。设计决策已固化到 `docs/P6_DESIGN.md`。
- **P6-01 Document Format Audit**(只读):审计 `.nodeflow` 项目格式(v2,type:'nodeflow-project')、静态导出(v1)、Save/Load Flow、数据五分类(Document/Editor/UI/Derived/Metadata)、版本机制现状(无正式版本门控)。发现风险:version 未校验(future version 可能被误加载)。
- **P6-02 Document Model & Version Design**(只读):设计正式 Project Format v3(`{format:'nodeflow',version:3,document:{graph,editor}}`)、JSON Export(`nodeflow-export`)、localStorage 模型升级(v2 key)、5 项数据边界决策(D1 历史不入文件 / D2 viewport 归 Editor / D3 tabs 归 Editor / D4 dirty 不入文件 / expanded 保存、hidden 派生)。
- **P6-02 Design Freeze Correction**(只读):两个关键语义修正——(1) Project 与 Export 是两个独立 Format Family,version namespace 独立,禁止 `Export v1 → Project v3` 作为 Migration Chain;(2) Persistent Document ID 暂不定案,`loadProject()` 重新生成 Runtime ID 是当前实现事实而非长期契约。
- **P6-03 Backward Compatibility Design**(只读):逐字段审计 Legacy Project v2,设计 Format/Version Detection、Future Version Gate(>current 安全拒绝)、Validation 三分类(Fatal/Recoverable/Derived)、Composite Migration(expanded 迁移、hidden 重算)、React Flow 字段清洗、History Discard、Broken Reference 处理、Migration 纯函数/确定性/不可变性、Load Failure Safety(当前文档+原文件不变)。
- **P6-03 Documentation Freeze**:把以上已确认设计决策固化为 `docs/P6_DESIGN.md`,作为 P6-04 实施的安全基线。

P6 路线图:P6-01~03 设计 ✅ → P6-04 Migration ⏳(待人工授权) → P6-05 Safe Persistence → P6-06 Validation → P6-07 Tests → P6-08 Real Project → P6-09 Error Handling → P6-10 Auto Save → P6 Gate。

---

## 2026-08-25 · P5 收尾 · Geometry 抽取(完成)

新建 `lib/geometry.ts` 几何工具层,从 graphStore 迁出纯几何逻辑。
- 迁入:`Rect` / `rectOverlaps`(重叠判定)、`pushOutOfRect`(最小位移推出)、`findStageEmptySpot`(空位寻找)、`pushNodesAwayFromBox`(组合展开推挤)
- graphStore 删除 127 行内部几何函数,改用 domain 函数(expandComposite / addStage / autoGrowStage)
- 新增 4 测试(重叠/推出/空位),完整套件 125 → **129 用例通过**;tsc / build 通过
- 至此 P5 系列核心领域(Graph/Composite/Gateway/Stage/Annotation/Artifact/Edge/Geometry)均已抽取为纯逻辑层并测试覆盖

---

## 2026-08-25 · P5-07 Edge Domain 抽取(完成)

新建 `lib/edge.ts` 连线领域纯逻辑层(连线路径计算已在 `lib/edgePath.ts`)。
- 新增纯函数:`createFlowEdge`(创建连线,可覆盖 data 与显式 id)、`canConnect`(端口连通性)
- graphStore 改用:`onConnect` / `insertNodeOnEdge`(upstream/downstream 创建)
- 新增 3 测试(创建默认/覆盖 id 与 data / 连通性),完整套件 122 → **125 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-06 Annotation / Artifact Domain 抽取(完成)

新建 `lib/annotation.ts` 与 `lib/artifact.ts`,抽取注释与中间产物的纯业务逻辑。
- `lib/annotation.ts`:`annotationTargetMatches` / `annotationTargetsNode` / `annotationTargetsEdge`(自 graphStore 迁入)、`anyAnnotationExpanded`(一键收起判定)、`createAnnotation`(创建)、`toggleAnnotationCollapsed`(切换折叠)
- `lib/artifact.ts`:`setEdgeArtifact` / `updateEdgeArtifact` / `hasArtifact`
- graphStore 改用:`addAnnotation` / `toggleAnnotationCollapsed` / `toggleAllAnnotations` / `setArtifact` / `updateArtifact`(等价替换);删除 3 个内部注释辅助函数
- 新增 8 测试(注释归属/创建/折叠判定 + 产物设置/更新/判断),完整套件 114 → **122 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-05 Stage Domain 抽取(完成)

新建 `lib/stage.ts` 阶段域领域纯逻辑层,graphStore 的 5 个 stage action 改用 domain 函数。
- 新增纯函数:`stageContainsNode`(完全包含判定)、`computeStageMembership`(归属判定)、`detachNodeIdsFromStages`(脱离)、`addNodeToStage`(加入/移出)、`computeStageMinSize`(最小覆盖尺寸)、`computeStageBounds`(归属节点包围盒)、`boundsToStageBox`(包围盒→域框)
- graphStore 改用:`syncStageMembership` / `resizeStage` / `enterNodeToStage` / `detachNodesFromStages` / `autoGrowStage`(包围盒计算)
- 新增 7 测试(包含判定/归属/脱离/加入/最小尺寸/包围盒/域框),完整套件 107 → **114 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-04 Gateway Domain 抽取(完成)

新建 `lib/gateway.ts` 网关领域纯逻辑层,从 `types.ts` 迁出网关常量与创建函数。
- 迁出:`GATEWAY_META` / `GATEWAY_KINDS` / `createGatewayNode`(types.ts 仅保留 GatewayType / GatewayMeta 类型定义,因 FlowNode 引用)
- 新增纯函数:`changeGatewayType`(类型切换,保留端口与 defaultBranch)、`setDefaultBranch`(兜底分支设置/清除)
- 收敛:`GATEWAY_BRANCH_COLORS` 分支配色板(FlowEdgeComponent 内联 8 色 → domain 常量);FlowCanvas 右键切换网关类型内联逻辑改用 `changeGatewayType`
- 更新 3 处 import(FlowCanvas / FlowNodeComponent / graphStore.composite.test)
- 新增 5 测试(create / changeGatewayType / setDefaultBranch),完整套件 102 → **107 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-03 Composite Domain 抽取(完成)

在 `lib/composite.ts` 新增组合关系查询纯函数 `findParentCompositeId` / `isChildOf`,graphStore 的 2 处「找父组合」逻辑改用 domain 函数(语义等价)。
- graphStore 中散落的 `childIds.includes(...)` 父组合查找收敛到 composite 领域
- 新增 3 测试(直接父组合 / 嵌套父组合 / isChildOf),完整套件 99 → **102 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-03 Composite Domain 抽取(第一步)

将 `applyCompositeBoxes`(重算展开组合虚线框,纯函数)从 `graphStore.ts` 迁移到 `lib/composite.ts`,Store 改为 import 调用。行为完全一致。
- `graphStore.ts` 的复合纯逻辑进一步收敛到 `lib/composite.ts`
- 新增 applyCompositeBoxes 3 测试(展开包裹 / 塌缩不重算 / 无变化返回原引用),完整套件 96 → **99 用例通过**;tsc / build 通过

---

## 2026-08-25 · P5-02 Graph Domain 抽取(完成)

将 `graphStore.ts` 中全部 16 处 `nodes.find` / `edges.find`(按 id 查找)替换为 domain 查询函数 `findNodeById` / `findEdgeById`。
- 语义完全等价,行为不变
- 完整套件 **96 用例通过**;tsc / build 通过
- `graphStore.ts` 的散落 find 全部收敛到 `src/domain/graph/queries.ts`

---

## 2026-08-25 · P5 开始 — P5-02 Graph Domain 抽取(第一步)

P5 目标:逐步把业务逻辑从 `graphStore.ts` 抽出,让 Store 调用 Domain。

**P5-02 第一步**:新建 `src/domain/graph/queries.ts` 纯查询模块,与 React / Zustand / Electron 解耦。
- `findNodeById` / `findEdgeById` / `findNodesByIds` / `findEdgesForNode` / `isNodeReferencedByEdge` / `isEdgeDangling` / `findDuplicateIds`
- Store 开始调用(`insertNodeOnEdge` 的 find 改用 domain 函数),其余 16 处 find 留待后续阶段逐步替换。

**测试**:新增 `src/domain/__tests__/graph.queries.test.ts` 6 用例,完整套件 90 → **96 用例通过**;tsc / build 通过。

---

## 2026-08-25 · P4 完成（P4-06 Gate 验收）

P4 全部完成,通过阶段闸门。新建 `docs/P4_COMPLETION.md` 记录验收结果。

**P4 交付**:Graph Validation + Invariant / Serialization / Undo-Redo 测试,共 **90 用例**(P4 前 45),tsc / build 通过;未改 UI、未改 `.nodeflow` 格式、未移动文件。

**P4 意义**:为后续 P5 拆解 Store 建立了安全网——任何重构后都可通过 validation / invariant / serialization / undo-redo 测试验证未破坏结构。

---

## 2026-08-25 · P4-05 Undo / Redo Tests

为历史栈建立回归保护:新增 `src/store/__tests__/undoredo.test.ts` 8 用例,验证 `S0 → Action → S1 → Undo → S0` 与 `S0 → Action → S1 → Undo → Redo → S1`。
- 覆盖:addNode / deleteNode(含连线恢复)/ groupSelected(编组)/ addStage / addAnnotation / copy-paste / 连续多次操作全量 undo
- 完整套件 82 → **90 用例通过**;tsc / build 通过

---

## 2026-08-25 · P4-04 Serialization Round Trip

为序列化建立 round-trip 保护:新增 `src/store/__tests__/serialization.roundtrip.test.ts` 6 用例,验证 `Graph → serializeProject/exportJson → loadProject → Graph` 语义一致。
- 覆盖:Node / Edge / Composite / Nested Composite / Gateway(类型 + 分支)/ Stage / Annotation / Artifact / viewport
- 损坏 JSON 加载失败且不破坏当前状态
- 完整套件 76 → **82 用例通过**;tsc / build 通过

---

## 2026-08-25 · P4-03 Graph Invariant Tests

为 P4-02 的 `validateGraph()` 建立更全面的不变量测试:新增 `src/lib/__tests__/graphValidation.invariant.test.ts` 14 用例。
- Nested Composite 合法 / 非法 child
- Composite 重复 child(warning)、展开 / 塌缩两种状态
- Edge 两端悬空、引用不存在端口
- Stage 引用同一节点(允许)、重复 Stage / Annotation ID
- Annotation node target 存在 / 不存在、canvas 归属 main / 不存在组合
- `cid:` 嵌套多层聚合端口解析
- 普通节点端口 id 重复(warning)、大规模节点 / 连线

完整套件 62 → **76 用例通过**;tsc / build 通过。

---

## 2026-08-25 · P4 架构加固 — P4-01 基线 + P4-02 Graph Validation

**P4-01 项目基线**:新建 `docs/P4_BASELINE.md`,记录 NodeFlow 当前真实状态(tsc / test / build 通过;`graphStore.ts` 2907 行;45 用例;关键入口定位),作为后续重构对照基准。未修改任何业务代码。

**P4-02 Graph Validation**:新增 `src/lib/graphValidation.ts` 纯检查函数 `validateGraph()`,回答「Graph 是否合法」,与 React / Zustand / Electron 解耦,只发现问题不自动修复。
- ID 唯一(Node / Edge / Stage / Annotation)
- Edge:source / target 存在性、handle 引用合法性(普通端口 + `cid:` 聚合端口)
- Composite:child 存在、不含自己、无重复 child
- Gateway:type 合法、至少 1 输入 + 1 输出分支、端口 id 唯一
- Stage:node 引用存在
- Annotation:node / edge target 存在

**测试**:新增 `src/lib/__tests__/graphValidation.test.ts` 17 用例(空图 / 单节点 / 正常边 / 悬空边 / 重复 ID / 非法 handle / Composite self-ref / Stage 非法引用 / Annotation 非法 target / Gateway 非法 type 与结构 / cid: handle),完整套件 45 → **62 用例通过**;tsc / build 通过。

---

## 2026-08-24 · 修复网关连线锚点与端点错位

**问题**:网关增删输入 / 输出端点后,连线锚点与端点视觉位置错位(截图确认)。

**根因**:React Flow 12 中,自定义 Handle 的 `id` / 位置变化时,React Flow 内部缓存的 handle bounds(用于计算连线锚点)不会自动更新,导致锚点与实际 DOM 位置不一致。

**修复**(`FlowNodeComponent.tsx`):引入 `useUpdateNodeInternals` hook,对网关节点(`data.gateway`)在 `data.inputs` / `data.outputs` 变化时自动调用 `updateNodeInternals(id)` 强制重算 handle bounds,使连线锚点与端点视觉位置对齐。

---

## 2026-08-24 · P3-3 网关增强(图标 / 分支彩色连线 / 注释)

- **执行主体图标**:网关菱形上方显示人 / 机器 / 人机协同图标(39px,点击轮换)。
- **锁定图标**:菱形下方居中(36px),与执行主体图标上下对称,🔓/🔒 切换锁定。
- **分支连线彩色**:从网关各分支引出的连线按分支序号从 8 色调色板取色,各分支颜色不同,便于区分流程走向。
- **注释**:网关悬停时红 pin 显示于锁定键下方,有注释持续显示;注释框展开时水平居中、高度对齐红 pin 位置(偏移 -2)。
- **分支命名**:默认「分支1 / 分支2」,新增按「分支3 / 分支4…」递增。

---

## 2026-08-24 · P3-3 网关增强(执行主体图标 / 锁定 / 分支命名)

- **执行主体图标**:网关上显示人 / 机器 / 人机协同图标(菱形上方居中,39px,点击轮换),与普通节点一致。
- **锁定图标**:网关菱形下方居中(与执行主体图标上下对称)显示 🔓/🔒,点击锁定 / 解锁。
- **分支命名**:默认分支改为「分支1 / 分支2」;新增分支按「分支3 / 分支4…」递增(不再叫「输出N」)。
- **网关与普通节点同等处理**:验证编组 / 解除编组 / 复制粘贴 / 阶段域 / 序列化 / 自动排列均天然生效(网关即 `FlowNode` + `data.gateway`)。

---

## 2026-08-24 · P3-3 逻辑判断与分支节点(完成)

**三种核心 BPMN 网关**:排他(XOR `×`)、并行(AND `+`)、包容(OR `○`),菱形外观 + 内部标记区分,颜色协调(排他橙 / 并行青 / 包容紫)。

**数据模型**:`GatewayType` + `FlowNodeData.gateway?: { type, defaultBranch }`;`createGatewayNode` 创建(1 输入 + 2 默认输出分支);随节点自动序列化 / 历史栈 / 阶段域归属 / 自动排列。

**交互**:
- 画布右键菜单直接创建三种网关(平铺项);网关上右键切换类型。
- 分支 + 汇聚:加输出分支(分支) / 加输入端口(汇聚);输入 / 输出端点以菱形左右顶点为中轴上下对称分布。
- 输入 / 输出端点贴菱形边角;`+` 按钮白色、放端点正下方(输入侧 left:96, 输出侧 left:283);删除 `×` 悬停显示;端点 label 白色。
- **连线锚点修复**:Handle 移除了 `transform: 'none'`(此前使 left/top 作为左上角而非圆心,导致连线视觉断开),改用默认 transform 居中,圆心即连线锚点,连线完整连到端点。

**测试**:新增 createGatewayNode 2 用例(三种类型端口结构 / 阶段域归属 + 序列化),完整套件 41 用例通过。

---

## 2026-08-24 · P3-2 阶段域增强(自动排列集成 / 去竖向 / 交互细节)

**自动排列集成阶段域**:全画布自动排列时——每个域内部节点先横向拓扑排列、域框收敛包裹(内边距 22);单节点域框大小对齐「除自身外最大的域」(修复:原实现取 sorted[1] 在仅 2 个域时会取到自身,改为排除自身取最大);所有阶段域框垂直中心水平对齐;各域作为整体块 + 游离节点做全局横向拓扑排列(域内连线映射为域块之间的边)。

**去掉竖向排列**:工具栏移除「横向 / 竖向」方向切换按钮,自动排列固定为横向拓扑排列。

**交互细节**:
- 新建阶段域自动进入名称编辑态(`AutoEditTarget` 新增 `stage-name` kind)。
- 双击阶段域名称进入编辑(双击建节点的原生监听新增 `.nf-stage` 排除,修复误建节点)。
- 新建阶段域自动放画布空白处(`findStageEmptySpot` 找空位,不与任何可见节点 / 其他域重合,间距 24)。
- 点击画布空白取消阶段域选中(`selectStage(null)`)。
- Delete / Backspace 键可删除选中的阶段域(合并进 `handleBeforeDelete`,确认后删除);删除域后内部节点 / 组合自动脱离、连线不变。
- 阶段域四边拖拽条命中区域 9px → 14px,更易选中拖动。

**测试**:新增 autoLayout 阶段域 2 用例(域框收敛包裹、单节点域大小对齐),完整套件 39 用例通过。

---

## 2026-08-24 · P3-2 流程阶段域(完成)

**流程阶段域(Stage)**:矩形虚线框区域,用于把相关节点划入同一阶段。

**数据模型**:`Stage { id, name, x, y, width, height, nodeIds, selected }`,文档级数组 `stages`,已纳入历史栈 / 撤销重做 / 多项目 / 序列化(保存项目、导出 JSON、localStorage 持久化)。

**交互设计**(经多轮调整):
- **归属(长按进入)**:节点拖入域框后继续按住 1 秒才归属(节点 + 域闪烁反馈),否则仅视觉叠加;一节点只能属一个域。
- **完全穿透**:域整体 `pointer-events: none`,域内节点 / 连线 / 中间产物完全不受影响,可执行一切正常操作。
- **拖拽 / 调整**:四边拖拽条 + 头部拖动移动域(内部节点保持相对关系);右下角手柄调整大小。
- **自动扩大 + 外部推挤**:拖拽域内节点时域框按节点包围盒(内边距 22)自动扩大,扩大后把重叠的外部节点 / 组合 / 其他阶段域按最小位移推开(间距 14)。
- **resize 最小覆盖**:缩小域框最小只能缩到覆盖所有域内节点,再小无效。
- **脱离**:选中节点右键「脱离阶段域」;域右键「脱离全部节点」「删除阶段域」。
- **光谱配色**:低饱和低明度光谱色,按域水平位置红→蓝紫,内部填充与边框同色。

**关键实现**:`stage-layer` overlay(z-index 10)需高于 React Flow 内置覆盖层;四边拖拽条避免单个矩形挡住内部节点;`autoGrowStage` 复用 `rectOverlaps` / `pushOutOfRect` 推挤工具。

**测试**:`resizeStage` 最小覆盖、`autoGrowStage` 扩大包裹 + 外部推挤共 3 用例,完整套件 37 用例通过。

---

## 2026-08-24 · 右键菜单增强(连线插入节点 + 组合展开/收起)

**连线右键菜单**:新增连线右键菜单,并提供「在此添加节点」——
- 新增 store action `insertNodeOnEdge(edgeId, position)`:在连线中间插入新节点,把原连线拆成两段,上游(源 → 新节点)**继承原连线的说明文字 / 中间产物**,下游(新节点 → 目标)为空白连线;原连线的**连线归属 / 产物归属注释一并转移到上游连线**;新节点自动选中并进入标题编辑;内部画布操作时新节点自动加入所属组合。
- 连线菜单另含「删除连线」(弹确认对话框)。
- 右键目标识别:节点(`.react-flow__node`)/ 连线 label(`[data-edge-id]`)/ 连线路径(`.react-flow__edge`)/ 画布四类,统一在右键松开时判定。

**组合节点右键**:新增「展开(显示内部节点)/ 收起(塌缩组合)」菜单项(按当前状态切换标签),与标题栏按钮一致。

- **单元测试**:`insertNodeOnEdge` 新增 3 用例(拆线连接正确 / 说明产物移到上游 / 注释转移到上游),完整套件 34 用例通过。

---

## 2026-08-24 · 修复展开组合节点内部不可交互

**问题**:展开组合节点(虚线框)后,内部节点无法拖拽、无法从端口拉线、无法选中 / 加删端点——鼠标事件全被组合框挡住。

**根因**:此前用 CSS `:has()`(`.react-flow__node:has(> .nf-composite-frame) { pointer-events: none }`)让展开组合节点的 React Flow 容器穿透事件。但当前运行环境(部分 WebView / Chromium 版本)**不支持 `:has()`**,样式完全无效,组合框仍盖住内部节点;尝试的 `zIndex` 提升内部节点方案也不稳定。

**修复**(双保险,均不依赖 `:has()` 兼容性):
- `graphStore.expandComposite` 给展开组合节点设置 `className: 'nf-expanded-frame'`——React Flow 会把 `node.className` 挂到 `.react-flow__node` 上,用**精确类选择器** `.react-flow__node.nf-expanded-frame { pointer-events: none }` 命中并穿透,仅标题栏 `composite-frame-bar` 恢复 `pointer-events: auto`。
- `FlowCanvas` 将展开组合的全部子节点 `zIndex` 提升为 `1`,渲染在组合框(默认 0)之上,保证内部节点优先接收事件。

效果:展开组合后,内部节点可正常拖拽 / 从端口拉线 / 选中 / 加删端点。

---

## 2026-08-24 · P3-1 注释框

**P3 首项完成**:实现注释框(Annotation)功能,支持画布 / 节点 / 连线 / 连线产物 / 组合节点多种主体。

- **注释框**:标题 + 内容,半透明、点状虚线边框、无背景;新建默认进入标题编辑,单击内容编辑,双击注释框进入编辑;`–` 收起、`×` 内联二次确认删除。
- **红色 pin 图标**:无注释悬停显示(节点 / 产物 / 组合正下方,连线说明上方,延迟消失便于点击);有注释收起持续显示,展开不显示;一个主体最多一个注释。
- **工具栏 💬 注释**:一键全部展开 / 收起所有注释。
- **画布归属注释**:独立 overlay 层跟随 viewport,可自由拖拽。
- **解除编组合并**:组合节点注释在解除编组后合并到第一个子节点(有注释合并内容,无则转移)。
- **序列化 / 持久化**:注释纳入历史栈、多文档隔离、项目保存(serializeProject)与 JSON 导出;删除节点 / 连线自动清理其注释。
- **单元测试**:注释 CRUD / toggleAll / 序列化 / 删除节点清理 / 解除编组合并注释,完整套件 31 用例通过。
- **修复**:
  - 双击注释框不再误触发画布新建节点(画布双击检测排除注释元素)。
  - 悬停一条连线 / 产物不再误触发其它主体的注释框(共享 EdgeLabelRenderer 无法用 CSS 兄弟选择器,改为按主体的 JS hover state 精确控制)。
  - 注释框与产物 / 连线说明的间距重叠问题(产物注释移至产物正下方,连线注释移至连线说明上方向上展开)。
  - 普通节点编辑文字时 `draggable:false` 被持久化导致刷新后无法拖拽(保存 / 加载时普通节点 draggable 强制可拖)。
  - 锁定全部时 per-node `draggable:true` 覆盖全局 `nodesDraggable`,导致末尾节点仍可拖(锁定时渲染强制所有节点不可拖)。

---

## v0.1.0 · 2026-08-23

**P2 收尾 + 版本升级**:完成 P2 剩余全部规划项,并增强桌面端项目文件体系:

- **保存 / 打开项目**:`serializeProject` 序列化当前项目完整编辑状态(含撤销 / 重做历史、组合标签、viewport)为 `.nodeflow` 项目文件;`loadProject` 从项目文件恢复为新文档(含历史),下次打开回到上次编辑位置;新增 `saveDocument(id)` 保存指定文档。
- **文件菜单重组**:新增「新建项目 / 打开项目 / 保存项目 / 关闭项目」;「导入」子菜单(导入 JSON);「导出」子菜单(导出 JSON / JPG / PDF,幅面可选 A5 / A4 / A3 / Letter,默认横版、完整画布居中适配);删除原「新建文档」。
- **导出实现**:JPG / PDF 用 `html-to-image` 截取整个画布(保留主题背景色 + 点阵,隐藏 MiniMap / Controls);SVG 数据驱动矢量重绘(`exportSvg.ts`)已实现但暂置灰待完善。
- **关闭项目**:标签栏 × 与文件菜单均可关闭;有未保存修改时提示保存(`confirmAndCloseDocument`);关闭唯一项目时自动新建空项目替换。
- **项目文件关联(桌面端)**:electron-builder `fileAssociations` 注册 `.nodeflow` 扩展名并绑定主程序图标;主进程处理双击打开(macOS `open-file` / Win/Linux 单实例 `second-instance` + argv),读取文件内容经 IPC 推送,渲染进程 `loadProject` 自动打开;preload 暴露 `window.nodeflow.onOpenProjectFile`。
- **复制 / 粘贴节点与组合**(P2 最后一项):`copySelection` / `pasteClipboard` 支持跨画布标签、跨项目复制粘贴;组合节点递归复制整个子图,重新生成节点 id / 端口 id / 组合 `childIds`,并重映射连线 handle(含 `cid:` 嵌套链);粘贴到当前视口中心或右键位置;`Ctrl/⌘+C`、`Ctrl/⌘+V` 快捷键 + 右键菜单。
- **新对象创建默认进入编辑模式**:新节点标题 / 新连线说明 / 新端口 label 创建后自动进入编辑态(共用 `EditableText` 的 `autoFocus` 机制,修复 contentEditable 时序与循环触发问题)。
- **节点标题长文本换行**:不再单行省略号截断,允许换行(不改节点宽度)。
- **单元测试**:`copySelection` / `pasteClipboard`(含组合递归复制、id / 端口 / handle 重映射)测试;`onNodesChange` select 与 `copySelection` 联动测试;完整套件 31 用例通过。
- **杂项**:`.gitignore` 忽略 `.playwright-cli/` 与 `package-lock.json`(项目统一用 bun);`bun.lock` 补入 `html-to-image` / `jspdf` 依赖。

---

## v0.7.0 · 2026-08-22

**P2 第 8 项(多画布 / 多文档)** — 单文档重构为完整多文档模型,支持多项目并行编辑:

- **完整多文档模型**:store 重构为 `documents[] + activeDocumentId`,每个文档独立 `nodes / edges / viewport / 组合内部画布标签 / 撤销历史`;通过「活动文档镜像字段」(保留顶层 `nodes/edges` 等)兼容现有所有 action,包装 `set` 自动同步回文档,切换文档时整体加载目标文档。
- **按文档隔离历史**:每个文档各自维护 `past / future` 栈,切换文档后撤销 / 重做不互相污染。
- **按文档独立持久化**:文档注册表(`nodeflow:docs:v1`)记录列表 / 名称 / 颜色 / 最近打开,每文档独立 key(`nodeflow:doc:<id>:v1`)存储;启动时迁移旧单文档(`nodeflow:graph:v1`)为默认文档。
- **多标签页界面**:工具栏下方标签栏 —— 项目文档标签(带颜色点,不同项目不同色,可切换 / 关闭 / 新建)+ 项目内主画布 / 组合内部画布标签(与主画布相邻,用分隔线区分项目标签与项目内标签)。
- **文档管理**:新增 `createDocument` / `switchDocument` / `closeDocument` / `renameDocument`;工具栏「新建文档」改为新建项目。

---

## v0.6.0 · 2026-08-22

**P2 第 6 项(自动布局)+ 连线交互优化** — 一键自动排列节点,并修复 / 优化连线删除、选中与层级:

- **自动布局(全画布 + 组合内)**:新增 `lib/layout.ts` —— `computeLevels` 拓扑分层(最长路径,环安全)、`computeLayout` 按层排列(横向 / 竖向),同层节点 barycenter 启发式排序减少交叉与压节点;工具栏新增「自动排列」按钮 + 横向 / 竖向互斥方向按钮;`autoLayout` store action 支持全画布 / 组合内作用范围;布局后重算展开态组合虚线框,撤销可用。
- **连线删除修复**:`onBeforeDelete` 原先只处理节点、忽略连线,导致仅选中连线时 Delete / Backspace 无法删除;重构为同时处理节点与连线(先删连线再删节点)。
- **连线选中高亮**:选中连线加粗(`stroke-width: 4`)并带 accent 光晕(`drop-shadow`),选中状态一目了然。
- **连线层级(方案 C)**:默认节点在连线之上(节点清晰);拖拽节点时临时把连线 / label 提升到节点之上,便于看清连线关系。
- 单元测试 `layout.test.ts`:拓扑分层 / 横向 / 竖向 / 同层不重叠(完整套件 31 用例通过)。

---

## v0.5.1 · 2026-08-22

**修复嵌套解除编组后内层组合连线丢失** — 嵌套组合解除编组时,内层组合的输出连线 handle 丢失中间路径,导致无法连接:

- **根因**:`unwrapToVisible`(展开外层时还原连线)使用 `decodeCompositePort`,只返回最外层节点与最终端口,丢失中间路径。例如还原 `cid:A:cid:P1:out1` 时 handle 被误还原为 `out1`(应为 A 的聚合端口 `cid:P1:out1`)。
- **修复**:重写 `unwrapToVisible` 逐层手动解析最外层节点与完整剩余引用,遇到塌缩组合时 handle 使用完整聚合端口引用。
- **回归测试**:新增 `nested-ungroup.test.ts` —— 构造编组 P1,P2→A → 连线 A→R → 再编组 A,Q→X → 解除 X,断言 A 的输出连线正确保留且 handle 为 A 聚合端口。完整测试套件 25 用例全部通过。

---

## v0.5.0 · 2026-08-22

**P2 第 5 项(单元测试覆盖核心纯函数)** — 引入 vitest 并为核心逻辑建立回归保护:

- 引入 `vitest`,新增 `test` / `test:watch` 脚本。
- `lib/composite.ts` 纯函数测试:端口编码 / 解码(含多层链式 `decodeCompositePortPath`)、`computeCompositeActor`(含嵌套递归)、`computeCompositePorts`(排除内部连线 / 重名降级 / 嵌套递归展平)、`computeCompositeBounds`、`getNodeSize`。
- graphStore 塌缩 / 展开状态机测试(通过 mock localStorage):编组塌缩(隐藏子孙 / 外部连线改写)、展开(恢复子节点 / 连线还原)、解除编组(删除组合 / 连线正确还原)。

---

## v0.4.0 · 2026-08-22

**P2 第 4 项(端点 / 端口删除与撤销恢复)** — 支持删除多余端口并撤销恢复端口与连线:

- **`removePort` store action**:删除节点的输入 / 输出端口(该方向至少保留 1 个),并同步删除连到该端口的连线(含塌缩聚合端口的 `cid:` 引用);通过 `markHistory` 使撤销可同时恢复端口与其对外连线。
- **删除入口**:普通节点端口(该方向 ≥2 时)悬停出现删除图标,紧贴文字 label 一侧;连线说明文字与中间产物悬停时右侧出现删除图标。
- **锁定隐藏**:节点锁定或全部锁定时,端口 / 连线说明 / 中间产物的删除图标均不显示。

---

## v0.3.0 · 2026-08-22

**P2 第 3 项(组合节点嵌套组合)** — 支持把已有组合节点编入更大的组合,递归处理聚合 / 显隐 / 连线 / 执行主体:

- **放开编组限制**:`groupSelected` 不再拒绝含组合节点的选中集;工具栏与右键菜单的「编组」对含组合节点可用。
- **端口链式编码**:新增 `decodeCompositePortPath`,端口引用支持多层链式(`cid:A:cid:B:port`);`computeCompositePorts` 递归展平嵌套组合的聚合端口(外层透出内层聚合端口)。
- **递归显隐**:塌缩外层组合时隐藏全部子孙(`collectAllDescendants`);展开时内层仍塌缩的组合其子节点保持隐藏(`refreshCompositeHidden` 递归判断最近塌缩祖先)。
- **连线递归改写 / 还原**:塌缩时外部连线改写到外层聚合端口(`wrapRefToOuter`,保证与聚合端口 id 一致);展开时逐层还原到当前可见层(`unwrapToVisible`)。
- **执行主体递归继承**:`computeCompositeActor` 递归取内层组合的继承结果,嵌套组合的图标 / 边框色正确。

---

## v0.2.0 · 2026-08-22

**P2 第 2 项(组合节点样式定制)+ 交互细节优化** — 组合节点精致化并自动继承内部节点属性,优化选中与端点命中:

- **组合节点执行主体继承**:新增 `lib/composite.ts` `computeCompositeActor` —— 内部全为同一主体显示该主体,混杂显示人机协同;组合节点图标(展开 / 塌缩)改用继承的 `ActorIcon`,移除手动轮换执行主体的按钮;属性面板执行主体区对组合节点只读并提示自动继承。
- **边框颜色自动继承**:组合节点边框色 / 光晕跟随继承的执行主体色(人-黄 / 机器-蓝 / 人机协同-绿),机器用更纯正的蓝 `#2f6fe0` 避免偏青;光晕颜色由边框最终颜色(`--nf-frame-border`)决定;移除此前临时加入的自定义边框颜色配置。
- **组合节点醒目化**:边框加粗(塌缩 4px / 展开 3px 虚线);光晕放大并含向内(`inset`)扩散光晕。
- **折叠动画**:展开 / 塌缩切换时淡入 + 轻微缩放(`nf-composite-pop`)。
- **选中态不改变边框颜色**:原选中态将边框置为 accent 蓝,与「机器=蓝」语义冲突造成误解;改为提亮边框 + 增强外圈 / 向内光晕,保留执行主体色。
- **端点命中区域放大**:`.react-flow__handle` 加 `::after` 扩大交互区域(视觉不变),`connectionRadius` 28 → 40,更易选中 / 连线吸附。

---

## v0.1.0 · 2026-08-22

**P2 第 1 项(执行主体颜色外框)+ 交互体验修复** — 节点外框按执行主体着色,并修复连线遮挡与画布交互:

- **执行主体颜色外框标识(P2-1)**:`ACTOR_META` 新增 `frame` 字段;节点外框按执行主体着色 —— 人-黄 / 机器-蓝 / 人机协同-绿,并带同色柔和光晕;选中态仍以 accent 高亮优先;组合节点(塌缩粗边框 / 展开虚线框)同样按执行主体着色。
- **连线避让节点**:新增 `lib/edgePath.ts` 绕障路径算法。连线(含文字说明与中间产物)默认不与节点重叠 —— 直角线(smoothstep)折线绕到节点一侧并保持最小距离,弧线(bezier)插入绕行点拐大弯避开;label/产物位于路径中点随路径避开节点。
- **右键拖拽不误弹菜单**:自定义右键菜单改在右键松开(`pointerup`)时判定,未发生拖拽位移才弹出;避免外接三键鼠标/部分平台「右键按下即触发 contextmenu」导致拖拽时误弹菜单。
- **mac 触控板与滚轮交互**:触控板两指滑动平移画布、两指捏合缩放;鼠标滚轮恢复缩放(与 Windows 一致),以光标为中心缩放;用原生捕获阶段监听 `wheel` 统一接管,避免 React Flow 抢占。
- **操作提示框按平台区分**:mac 提示两指滑动平移/两指捏合缩放,Windows 提示滚轮缩放;撤销重做快捷键符号区分(⌘Z / ⇧⌘Z 与 Ctrl+Z / Ctrl+Shift+Z)。

---

## v0.0.9 · 2026-08-22

**删除与双击建节点修复 + README 更新** — 修复多选删除失效与双击画布无法建节点:

- **多选删除修复**:React Flow 12 的 `onBeforeDelete` 对 Promise<boolean> 返回值处理不可靠,导致选中多个节点按 Delete 删除无效。改为 `onBeforeDelete` 始终返回 false 阻止自动删除,确认后手动调用 `deleteNode` 逐个删除,单节点与多选删除均可靠。
- **双击画布建节点修复**:`selectionOnDrag` 会拦截 pane 的 click/dblclick 事件,导致双击画布无法创建节点。改用画布容器原生捕获阶段监听 `pointerdown` 计数检测双击,绕过拦截;双击节点文字仍进入编辑,互不干扰。
- **README 更新**:补充删除确认 / 多选删除 / 撤销还原连线等最新交互说明。

> 说明:原计划 v0.0.8.1 已被放弃,本次改动并入 v0.0.9 发布。

---

## v0.0.8 · 2026-08-22

**删除确认与历史还原优化** — 删除节点确认 + 撤销完整还原连线 + 端口颜色修复:

- **删除确认对话框**:新增 `ConfirmDialog` 模态确认组件,右键菜单删除与 Delete/Backspace 键删除均弹确认框(经 `onBeforeDelete` Promise),演示模式禁用。
- **撤销删除还原连线**:修复 React Flow 删除节点时先删边(`onEdgesChange`)后删节点(`onNodesChange`)导致两次记历史、撤销无法还原连线的问题;用同步标志合并为一次「删除前含连线」快照,撤销(Ctrl+Z)可完整还原节点及其连线。
- **端口颜色修复**:端口连接状态改为按「节点 id + 端口 id」精确匹配,避免不同节点同名默认端口(`in_1`/`out_1`)被误判为已连接;新节点无连线默认端口显示桔色(未连接),连线后变绿色(已连接)。

---

## v0.0.7 · 2026-08-22

**连线快速建节点** — 从端口拖出连线到画布空白处自动创建新节点并连接:

- **从输出端口拖出** → 在松开处创建新节点,连线从原输出端口连到新节点输入端口。
- **从输入端口拖出** → 创建新节点,连线从新节点输出端口连到原输入端口。
- 新节点创建在拖放位置并自动选中;支持鼠标与触摸;内部画布中操作会自动加入所属组合。

---

## v0.0.6 · 2026-08-22

**交互体验优化** — 修复节点拖拽 / 文字编辑冲突,新增画布交互与右键菜单:

- **节点文字编辑** — 修复双击编辑时无法选择 / 修改文字的问题;双击进入编辑,编辑中拖动仅选择文字,不拖动节点。
- **节点拖拽与画布平移解耦** — 左键拖拽节点 / 框选,右键按住拖动画布平移,右键单击弹出菜单;修复了 `panOnDrag` 含右键导致节点无法拖拽的 bug。
- **框选多个节点** — 左键画布空白拖拽画框选中一个或多个节点。
- **右键上下文菜单** — 画布菜单(添加节点 / 锁定全部 / 连线风格 / 显示全部 / 保存 / 另存为);节点菜单(复制 / 锁定 / 编组为复合节点 / 删除二次确认);复合节点额外提供「解除编组」。
- **执行主体图标** — 使用软件图标中的角色图(戴眼镜小人 / 机器人 / 人机协同合影),替代 emoji,新增 `assets/actors/` 资源与 `ActorIcon` 组件。
- **背景点阵修复** — 移除 `.react-flow` 上固定的 radial-gradient 点阵,只保留 `<Background>` 组件渲染的点阵,消除缩放时的两层点阵。
- **操作提示框** — 画布左上角新增可缩小的半透明操作提示,说明基本交互。

---

## 2026-08-21 · P1 体验增强 + 软件图标

完成 P1 未完成项,并配置软件图标:

1. **展开态组合节点对外连线** — 展开虚线框左右边缘渲染聚合端口 Handle(与塌缩态同为 `cid:` 编码),可直接对外连线;塌缩不改写聚合连线、再展开解码还原,数据状态机天然兼容。
2. **弹窗快照实时刷新** — `CompositePopupView` 监听 `storage` 事件并 2s 轮询兜底,主窗口覆盖快照后独立窗口自动同步,不再需要手动重建。
3. **组合节点 actor 与标题推断** — 新增 `majorityActor` 按子节点多数派推断执行主体,标题改为「{主体}协作流程(N)」。
4. **聚合端口重名区分** — `computeCompositePorts` 对同方向重名端口按「节点名.端口名」降级命名。
5. **撤销/重做标签页完整联动** — `GraphSnapshot` 记录 `compositeTabs`/`activeTabId`,`undo`/`redo`/`jumpTo` 通过 `restoreTabsFromSnapshot` 完整恢复,旧快照回退为按节点过滤。
6. **软件图标** — 新增 `assets/icon.png`,`electron/main.ts` 主/子窗口设置 `icon`,`package.json` electron-builder 配置 `icon` 并打包 `assets/`;下一个 GitHub release 将自动带上图标。

---

## v0.0.5 · 2026-08-21

**P1 体验增强 + 软件图标** — 完成全部 P1 未完成项,并为应用配置软件图标:

- **展开态组合节点对外连线**:展开虚线框左右边缘渲染聚合端口 Handle,可直接对外连线。
- **弹窗快照实时刷新**:`storage` 事件 + 轮询兜底,独立窗口自动同步主窗口快照。
- **组合节点 actor 与标题推断**:按子节点多数派推断执行主体,标题为「{主体}协作流程(N)」。
- **聚合端口重名区分**:同方向重名端口按「节点名.端口名」降级命名。
- **撤销 / 重做标签页完整联动**:历史快照记录标签状态,历史跳转完整恢复。
- **软件图标**:主 / 子窗口设置图标,electron-builder 打包 `assets/icon.png`,发布到 GitHub Releases 自动带上。

---

## 2026-08-21 · 组合节点 P0 正确性修复(已提交 d0d974e)

修复三个 P0 问题,组合节点功能达到「可提交」状态:

1. **清理悬空外部连线** — 删除塌缩组合内子节点时,通过解码 `cid:` 端口一并清理指向该子节点的外部连线(`edgeReferencesNode`);删除后统一刷新聚合端口与隐藏状态。
2. **聚合端口单一数据源** — 属性面板聚合输入/输出改为实时 `computeCompositePorts` 计算,与画布展示一致,不再依赖塌缩时写入的快照。
3. **内部画布新建节点原子记录历史** — 新增 `addNodeToComposite` action,把「创建节点 + 加入 childIds + 塌缩态隐藏」合并为一次历史记录,替换原先 `addNode` 后 `setState` 直改 `hidden` 的做法。

---

## 2026-08 · 组合节点(Compound Node)子系统 — 进行中

**目标**:支持多节点聚合为组合节点,展开 / 塌缩 / 内部画布 / 弹窗编辑。

**已完成:**

- [x] 组合节点数据模型:`CompositeMeta { expanded, childIds }`,组合即引用不复制。
- [x] 聚合端口:`cid:` 可逆编码、聚合计算(`computeCompositePorts`)、塌缩快照写入。
- [x] 创建组合 `groupSelected`(≥2 个非组合节点)。
- [x] 塌缩 / 展开状态机,子节点与内部连线显隐管理。
- [x] 外部连线改写与还原(塌缩时指向组合节点,展开时还原)。
- [x] 删除组合节点前自动展开,避免误删内部内容。
- [x] 内部画布三种入口:展开虚线框 / 标签页 Tab / 独立弹窗(只读快照)。
- [x] 大纲面板、属性面板适配组合节点。
- [x] 历史(撤销 / 重做)与内部画布标签联动。

**已知边界问题(详见 `TODO.md`):**

- 聚合端口快照与实时计算双源,极端时序下可能不一致。
- 塌缩状态下删除子节点可能遗留指向 `cid:` 端口的悬空外部连线。
- 内部画布新建节点直接 `setState` 改 hidden,绕开历史记录。

---

## v0.0.4 · 2026-08-21 (commit d0d974e)

**组合节点(Compound Node)完整功能** — 支持将多个节点聚合为组合节点,可塌缩 / 展开 / 内部画布编辑:

- 组合节点数据模型(`CompositeMeta { expanded, childIds }`),聚合即引用不复制。
- 聚合端口 `cid:` 可逆编码、实时聚合计算(`computeCompositePorts`)。
- 创建组合(≥2 个非组合节点)、塌缩 / 展开状态机、外部连线改写与还原、删除前自动展开。
- 内部画布三种入口:展开虚线框 / 标签页 Tab / 独立弹窗。
- 大纲面板、属性面板适配组合节点;历史与内部画布标签联动。
- P0 修复:删除子节点清理悬空外部连线;聚合端口展示统一为实时计算;内部画布新建节点原子记录历史。

## v0.0.3 · 2026-08-21 (commit 2830153)

- 节点标题 / 描述 / 端口名 / 连线标签支持**内联编辑**(contentEditable)。
- 端口**光晕**显示连接状态(绿=已连接 / 桔=未连接)。
- **连线置顶**策略,改善可读性。
- 一键锁定**演示模式**(全局锁定,禁止一切编辑)。
- 中间产物(Artifact)创建 / 编辑 / 删除。

## v0.0.2 · 2026-08 (commit 9ff80ce)

- 端口**快捷添加**(`+` 按钮,支持输入 / 输出)。
- **弧线连线**自定义渲染。
- 浅色主题美化。

## v0.0.1 · 2026-08 (commit b67918b)

- NodeFlow 跨平台节点式流程绘图工具首个可用版本。
- Electron + React + React Flow + Zustand 基础框架。
- 节点 / 连线 / 拖拽 / 缩放 / 小地图 / 控制按钮。
- localStorage 自动保存、JSON 导入 / 导出。
- 撤销 / 重做历史。
- 执行主体(Actor)、节点锁定。

## 基础设施 / CI (早期提交)

- `3d5c04b` Initial commit。
- `b8ddc1a` electron-builder 三平台打包 + GitHub Actions 自动发布。
- `b75d974` CI 构建不自动上传 Releases,统一由发布 job 处理。
- `1516e2f` vite 配置改用 `.mts`,消除 CJS deprecation 警告。
- `2d60d4b` 添加 author.email 满足 Linux .deb 包要求。
- `ab302d3` / `2d6e53f` 升级 GitHub Actions / upload-artifact,消除 Node 20 弃用警告。
