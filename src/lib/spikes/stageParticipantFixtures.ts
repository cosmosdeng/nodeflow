/**
 * Spike fixtures:10 组 synthetic + 1 组 real-like(复现运行时观察到的真实复杂图
 * 语义结构,ID 语义等价但非原样拷贝)。
 *
 * 仅供 spike 验证使用,不进入生产路径。
 */
import type { FlowEdge, FlowNode, Participant, Stage } from '../../types';
import type { SpikeInput } from './stageParticipantArrangeSpike';

const part = (id: string, name = id): Participant => ({ id, name, type: 'person' });

const stg = (id: string, nodeIds: string[] = [], name = id): Stage => ({
  id,
  name,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  nodeIds,
});

let seq = 0;
const edge = (source: string, target: string): FlowEdge => ({
  id: `e${seq++}_${source}_${target}`,
  source,
  target,
  type: 'flow',
  data: { label: '', artifact: null },
});

interface NdOpts {
  pid?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  comp?: string[];
  label?: string;
}

const nd = (id: string, opts: NdOpts = {}): FlowNode => ({
  id,
  type: 'flow',
  position: { x: opts.x ?? 0, y: opts.y ?? 0 },
  width: opts.w ?? 240,
  height: opts.h ?? 150,
  data: {
    label: opts.label ?? id,
    description: '',
    actor: 'machine',
    locked: false,
    inputs: [],
    outputs: [],
    ...(opts.pid ? { participantId: opts.pid } : {}),
    ...(opts.comp ? { composite: { childIds: opts.comp, expanded: false } } : {}),
  },
});

const fresh = () => {
  seq = 0;
};

export interface Fixture {
  name: string;
  input: () => SpikeInput;
}

export const fixtures: Fixture[] = [
  {
    // 01_basic:两个 assigned 跨不同 participant / stage,语义序决定 X/Y
    name: '01_basic',
    input: () => {
      fresh();
      const s1 = stg('s1', ['nA']);
      const s2 = stg('s2', ['nB']);
      return {
        participants: [part('p1'), part('p2')],
        participantOrder: ['p1', 'p2'],
        stages: [s1, s2],
        stageOrder: ['s1', 's2'],
        nodes: [
          nd('nA', { pid: 'p1', x: 0, y: 0 }),
          nd('nB', { pid: 'p2', x: 400, y: 200 }),
          nd('nFree', { x: 2000, y: 2000 }),
        ],
        edges: [edge('nA', 'nB')],
      };
    },
  },
  {
    // 02_same_cell:同 (participant, stage) 三节点,cell 内按拓扑不反向
    name: '02_same_cell',
    input: () => {
      fresh();
      const s1 = stg('s1', ['nIn1', 'nMid', 'nOut']);
      return {
        participants: [part('p1')],
        participantOrder: ['p1'],
        stages: [s1],
        stageOrder: ['s1'],
        nodes: [
          nd('nIn1', { pid: 'p1', x: 0, y: 0 }),
          nd('nMid', { pid: 'p1', x: 10, y: 200 }),
          nd('nOut', { pid: 'p1', x: 20, y: 400 }),
        ],
        edges: [edge('nIn1', 'nMid'), edge('nMid', 'nOut')],
      };
    },
  },
  {
    // 03_cross_participant:跨 participant handoff 链;行/列语义必须保持
    name: '03_cross_participant',
    input: () => {
      fresh();
      const s1 = stg('s1', ['A']);
      const s2 = stg('s2', ['B']);
      const s3 = stg('s3', ['C']);
      return {
        participants: [part('p1'), part('p2'), part('p3')],
        participantOrder: ['p1', 'p2', 'p3'],
        stages: [s1, s2, s3],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [
          nd('A', { pid: 'p1', x: 0, y: 0 }),
          nd('B', { pid: 'p2', x: 400, y: 0 }),
          nd('C', { pid: 'p3', x: 800, y: 0 }),
        ],
        edges: [edge('A', 'B'), edge('B', 'C')],
      };
    },
  },
  {
    // 04_stage_only:无 participant、有 stage 的节点绝不能进 free,须进其 stage 列
    name: '04_stage_only',
    input: () => {
      fresh();
      const s1 = stg('s1', ['qc1', 'qc2']);
      const s2 = stg('s2', ['qc3', 'host']);
      return {
        participants: [part('p1')],
        participantOrder: ['p1'],
        stages: [s1, s2],
        stageOrder: ['s1', 's2'],
        nodes: [
          nd('qc1', { x: 100, y: 100 }),
          nd('qc2', { x: 140, y: 400 }),
          nd('qc3', { x: 800, y: 60 }),
          nd('host', { pid: 'p1', x: 500, y: 0 }),
        ],
        edges: [edge('qc1', 'qc2'), edge('qc2', 'qc3')],
      };
    },
  },
  {
    // 05_row_only:有 participant、无 stage 节点须留在其 participant 行(不 free)
    name: '05_row_only',
    input: () => {
      fresh();
      const s1 = stg('s1', ['nA']);
      return {
        participants: [part('p1'), part('p2')],
        participantOrder: ['p1', 'p2'],
        stages: [s1],
        stageOrder: ['s1'],
        nodes: [
          nd('nA', { pid: 'p1', x: 0, y: 0 }),
          nd('nR', { pid: 'p1', x: 60, y: 60 }),
          nd('nB', { pid: 'p2', x: 0, y: 400 }),
        ],
        edges: [edge('nA', 'nR'), edge('nR', 'nB')],
      };
    },
  },
  {
    // 06_free:远端 free 保持;近处仅轻微压行带的 free 做局部小幅避让
    name: '06_free',
    input: () => {
      fresh();
      const s1 = stg('s1', ['nA']);
      return {
        participants: [part('p1')],
        participantOrder: ['p1'],
        stages: [s1],
        stageOrder: ['s1'],
        nodes: [
          nd('nA', { pid: 'p1', x: 0, y: 0 }),
          nd('far', { x: 3000, y: 3000 }),
          nd('edgeFree', { x: 400, y: 140 }), // 仅轻微压到行带下沿 → 小幅避让
        ],
        edges: [edge('nA', 'edgeFree')],
      };
    },
  },
  {
    // 07_split:并行拆分,两个分支同 cell 堆叠不反向,汇点在下游列
    name: '07_split',
    input: () => {
      fresh();
      const s1 = stg('s1', ['GW']);
      const s2 = stg('s2', ['b1', 'b2']);
      const s3 = stg('s3', ['M']);
      return {
        participants: [part('p1'), part('p2')],
        participantOrder: ['p1', 'p2'],
        stages: [s1, s2, s3],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [
          nd('GW', { pid: 'p1', x: 0, y: 0 }),
          nd('b1', { pid: 'p2', x: 300, y: 0 }),
          nd('b2', { pid: 'p2', x: 300, y: 400 }),
          nd('M', { pid: 'p2', x: 700, y: 0 }),
        ],
        edges: [edge('GW', 'b1'), edge('GW', 'b2'), edge('b1', 'M'), edge('b2', 'M')],
      };
    },
  },
  {
    // 08_merge:汇聚(语义同 07 反向即 merge)
    name: '08_merge',
    input: () => {
      fresh();
      const s1 = stg('s1', ['b1', 'b2']);
      const s2 = stg('s2', ['M']);
      return {
        participants: [part('p1'), part('p2')],
        participantOrder: ['p1', 'p2'],
        stages: [s1, s2],
        stageOrder: ['s1', 's2'],
        nodes: [
          nd('b1', { pid: 'p1', x: 0, y: 0 }),
          nd('b2', { pid: 'p1', x: 10, y: 400 }),
          nd('M', { pid: 'p2', x: 600, y: 0 }),
        ],
        edges: [edge('b1', 'M'), edge('b2', 'M')],
      };
    },
  },
  {
    // 09_gateway:网关节点的语义归属 = 它与普通节点同样按 pid/stage 分类
    name: '09_gateway',
    input: () => {
      fresh();
      const s1 = stg('s1', ['gIn', 'nA']);
      return {
        participants: [part('p1'), part('p2')],
        participantOrder: ['p1', 'p2'],
        stages: [s1],
        stageOrder: ['s1'],
        nodes: [
          nd('gIn', { x: 100, y: 100, w: 300, h: 180 }),
          nd('gOut', { x: 500, y: 500, w: 300, h: 180 }),
          nd('nA', { pid: 'p1', x: 0, y: 0 }),
          nd('nB', { pid: 'p2', x: 40, y: 300 }),
        ],
        edges: [edge('gIn', 'gOut'), edge('gIn', 'nA'), edge('nA', 'nB')],
      };
    },
  },
  {
    // 10_T16_conflict:语义硬约束间固有冲突必须显式报告,禁止"偷改语义"消解
    name: '10_T16_conflict',
    input: () => {
      fresh();
      const s1 = stg('s1', ['A']);
      const s2 = stg('s2', ['C']);
      const s3 = stg('s3', ['B']);
      return {
        participants: [part('p1'), part('p2'), part('p3')],
        participantOrder: ['p1', 'p2', 'p3'],
        stages: [s1, s2, s3],
        stageOrder: ['s1', 's2', 's3'],
        nodes: [
          nd('A', { pid: 'p1', x: 0, y: 0 }),
          nd('C', { pid: 'p3', x: 500, y: 0 }),
          nd('B', { pid: 'p2', x: 1000, y: 0 }),
        ],
        edges: [edge('A', 'C'), edge('C', 'B')],
      };
    },
  },
  {
    // real_like:复现运行时复杂图(种子链 + 复合 + 双阶段 + 双参与方 + 网关分支 + 游离)
    name: 'real_like',
    input: () => {
      fresh();
      const qc = stg('qc', ['seed_4', 'g60uoi'], '质检');
      const g1 = stg('g1', ['composite', 'chvx9j'], '1');

      const seed1 = nd('seed_1', { x: -668, y: 454, w: 230, h: 186, label: '需求收集' });
      const seed2 = nd('seed_2', { x: 0, y: 0, w: 230, h: 211, label: '脚本撰写' });
      const seed3 = nd('seed_3', { x: 490, y: 0, w: 230, h: 186, label: '素材渲染' });
      const composite = nd('composite', { pid: 'pA', x: 104, y: 80, w: 230, h: 180, comp: ['seed_2', 'seed_3'], label: '人机协同协作流程(2)' });
      const seed4 = nd('seed_4', { x: 2045, y: 580, w: 230, h: 211, label: '人工质检' });
      const seed5 = nd('seed_5', { x: 3795, y: 420, w: 230, h: 218, label: '发布上架' });
      const chvx9j = nd('chvx9j', { x: 530, y: 722, w: 230, h: 168, label: '新节点' });
      const y7onq = nd('y7onq', { x: 1080, y: 732, w: 230, h: 193, label: '新节点' });
      const g60uoi = nd('g60uoi', { x: 2703, y: 798, w: 230, h: 168, label: '新节点' });
      const para = nd('para', { x: 896, y: -283, w: 380, h: 220, label: '并行网关' });
      const lwmlyn = nd('lwmlyn', { x: 1362, y: -505, w: 230, h: 168, label: '新节点' });
      const node5dd = nd('node5dd', { x: 1479, y: 388, w: 230, h: 168, label: '新节点' });
      const incl = nd('incl', { x: 2330, y: -332, w: 380, h: 220, label: '包容网关' });
      const trz240 = nd('trz240', { x: 3049, y: -228, w: 230, h: 168, label: '新节点' });

      return {
        participants: [part('pA', 'A'), part('pB', 'B')],
        participantOrder: ['pA', 'pB'],
        stages: [qc, g1],
        stageOrder: ['qc', 'g1'],
        nodes: [seed1, seed2, seed3, composite, seed4, seed5, chvx9j, y7onq, g60uoi, para, lwmlyn, node5dd, incl, trz240],
        edges: [
          edge('seed_1', 'composite'),
          edge('composite', 'seed_4'),
          edge('seed_4', 'seed_5'),
          edge('composite', 'chvx9j'),
          edge('chvx9j', 'y7onq'),
          edge('y7onq', 'seed_4'),
          edge('seed_4', 'g60uoi'),
          edge('g60uoi', 'seed_5'),
          edge('composite', 'para'),
          edge('para', 'lwmlyn'),
          edge('para', 'node5dd'),
          edge('lwmlyn', 'incl'),
          edge('node5dd', 'incl'),
          edge('incl', 'trz240'),
          edge('trz240', 'seed_5'),
        ],
      };
    },
  },
];
