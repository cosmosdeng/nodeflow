# spikes

实验性 fixture / spike 模块，**仅被 `__tests__` 引用，不进入应用打包产物**。

- `freePlacementSpike.ts` — 自由放置实验
- `stageOnlyAnchorSpike.ts` — stage-only 锚点实验
- `stageParticipantArrangeSpike.ts` — 参与方×阶段排列实验
- `*Fixtures.ts` — 测试用确定性夹具

合并进正式模块前按 `docs/experiments` 规则干净重写，再从本目录移除。
