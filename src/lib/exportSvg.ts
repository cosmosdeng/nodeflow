import { Position } from '@xyflow/react';
import { ACTOR_META, type FlowEdge, type FlowNode, type ThemeMode } from '../types';
import { computeCompositeActor } from './composite';
import { computeEdgePath } from './edgePath';
import type { PaperSize } from './exportImage';

/* ------------------------------------------------------------------ */
/* 数据驱动 SVG 矢量导出:读取 nodes/edges 数据,用 SVG 原生元素(矩形/文字/路径) */
/* 重绘,避免 html-to-image 的 foreignObject 方案不可靠的问题。           */
/* ------------------------------------------------------------------ */

interface ThemePalette {
  bg: string;
  bgPanel: string;
  bgPanel2: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  edgeStroke: string;
  dot: string;
  accent: string;
}

const DARK: ThemePalette = {
  bg: '#17181c',
  bgPanel: '#1e2026',
  bgPanel2: '#23252c',
  border: '#33363f',
  text: '#e6e8ee',
  textDim: '#9aa0ad',
  textFaint: '#6b7180',
  edgeStroke: '#7d8494',
  dot: 'rgba(255,255,255,0.055)',
  accent: '#4ea1ff',
};

const LIGHT: ThemePalette = {
  bg: '#f4f5f8',
  bgPanel: '#ffffff',
  bgPanel2: '#eceef3',
  border: '#dcdfe6',
  text: '#1d2129',
  textDim: '#555d6b',
  textFaint: '#8a91a0',
  edgeStroke: '#9aa2b0',
  dot: 'rgba(20,25,40,0.09)',
  accent: '#2563eb',
};

const NODE_W = 230;
const HEADER_H = 40;
const DESC_LINE_H = 16;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 节点内端口的垂直位置(相对节点顶部),按 body 区域均匀分布 */
function portYInNode(
  portIndex: number,
  portCount: number,
  hasGroupTitle: boolean,
  headerH: number,
  descH: number,
  nodeH: number,
): number {
  const bodyTop = headerH + descH;
  const bodyBottom = nodeH - 6;
  const inner = bodyBottom - bodyTop;
  const titleH = hasGroupTitle ? 16 : 0;
  const avail = Math.max(inner - titleH, 0);
  // 端口均匀分布在可用区域内
  const n = Math.max(portCount, 1);
  const slot = avail / n;
  return bodyTop + titleH + slot * (portIndex + 0.5);
}

function nodeDescHeight(node: FlowNode): number {
  const d = node.data?.description;
  if (!d) return 0;
  const lines = Math.max(1, Math.ceil(d.length / 26));
  return lines * DESC_LINE_H + 10;
}

function effectiveActor(node: FlowNode, nodesById: Map<string, FlowNode>): FlowNode['data']['actor'] {
  if (node.data?.composite) {
    const children = node.data.composite.childIds.map((id) => nodesById.get(id)).filter(Boolean) as FlowNode[];
    return computeCompositeActor(children, nodesById);
  }
  return node.data.actor;
}

export interface SvgExportResult {
  svg: string;
  width: number;
  height: number;
}

/**
 * 生成数据驱动的 SVG 画布(世界坐标 → 幅面坐标自适应)。
 */
export function buildSvg(
  nodes: FlowNode[],
  edges: FlowEdge[],
  theme: ThemeMode,
  paper: PaperSize,
  bounds: { left: number; top: number; width: number; height: number },
): SvgExportResult {
  const pal = theme === 'dark' ? DARK : LIGHT;
  const visible = nodes.filter((n) => !n.hidden);
  const nodesById = new Map(visible.map((n) => [n.id, n]));

  // 幅面输出尺寸
  const margin = 0.06;
  const outW = paper.width === 0 ? Math.max(800, bounds.width + 80) : paper.width;
  const outH = paper.height === 0 ? Math.max(600, bounds.height + 80) : paper.height;
  const padX = Math.round(outW * margin);
  const padY = Math.round(outH * margin);
  const availW = outW - padX * 2;
  const availH = outH - padY * 2;

  const cw = bounds.width > 0 ? bounds.width : 1;
  const ch = bounds.height > 0 ? bounds.height : 1;
  const scale = Math.min(availW / cw, availH / ch);
  // 世界坐标 → SVG 坐标
  const sx = (x: number) => outW / 2 + (x - (bounds.left + bounds.width / 2)) * scale;
  const sy = (y: number) => outH / 2 + (y - (bounds.top + bounds.height / 2)) * scale;

  // 计算节点高度与端口位置
  interface NodeLayout {
    node: FlowNode;
    x: number;
    y: number;
    w: number;
    h: number;
    ports: { id: string; name: string; side: 'in' | 'out'; y: number }[];
  }
  const layouts: NodeLayout[] = visible.map((n) => {
    const w = n.measured?.width ?? NODE_W;
    const headerH = HEADER_H;
    const descH = nodeDescHeight(n);
    const h = n.measured?.height ?? headerH + descH + 70;
    const inputs = n.data.inputs ?? [];
    const outputs = n.data.outputs ?? [];
    const ports: NodeLayout['ports'] = [];
    inputs.forEach((p, i) =>
      ports.push({ id: p.id, name: p.name, side: 'in', y: portYInNode(i, inputs.length, true, headerH, descH, h) }),
    );
    outputs.forEach((p, i) =>
      ports.push({ id: p.id, name: p.name, side: 'out', y: portYInNode(i, outputs.length, true, headerH, descH, h) }),
    );
    return { node: n, x: n.position.x, y: n.position.y, w, h, ports };
  });

  const layoutById = new Map(layouts.map((l) => [l.node.id, l]));

  // 障碍物(用于连线绕行)
  const obstacles = layouts
    .filter((l) => l.node.id !== undefined)
    .map((l) => ({ x: l.x, y: l.y, width: l.w, height: l.h }));

  // ---- 绘制连线 ----
  const edgeParts: string[] = [];
  for (const e of edges) {
    const srcLayout = layoutById.get(e.source);
    const tgtLayout = layoutById.get(e.target);
    if (!srcLayout || !tgtLayout) continue;
    const srcPort = srcLayout.ports.find((p) => p.side === 'out' && p.id === e.sourceHandle) ?? srcLayout.ports.find((p) => p.side === 'out');
    const tgtPort = tgtLayout.ports.find((p) => p.side === 'in' && p.id === e.targetHandle) ?? tgtLayout.ports.find((p) => p.side === 'in');
    if (!srcPort || !tgtPort) continue;
    const sX = srcLayout.x + srcLayout.w;
    const sY = srcLayout.y + srcPort.y;
    const tX = tgtLayout.x;
    const tY = tgtLayout.y + tgtPort.y;
    const edgeStyle = 'smoothstep' as const;
    const { path } = computeEdgePath({
      sourceX: sX,
      sourceY: sY,
      sourcePosition: Position.Right,
      targetX: tX,
      targetY: tY,
      targetPosition: Position.Left,
      obstacles,
      edgeStyle,
    });
    // 变换路径坐标
    const transformed = transformPath(path, sx, sy, scale);
    edgeParts.push(
      `<path d="${esc(transformed)}" fill="none" stroke="${pal.edgeStroke}" stroke-width="${2 * scale}" stroke-linecap="round" />`,
    );
    // 连线 label
    if (e.data?.label) {
      const mx = (sX + tX) / 2;
      const my = (sY + tY) / 2;
      const fs = Math.max(9, 11 * scale);
      edgeParts.push(
        `<g transform="translate(${sx(mx)} ${sy(my)})">` +
          `<rect x="-${fs * 1.6}" y="-${fs * 0.7}" width="${fs * 3.2}" height="${fs * 1.5}" rx="${fs * 0.4}" fill="${pal.bgPanel2}" stroke="${pal.border}" />` +
          `<text x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" fill="${pal.textDim}" font-family="system-ui,sans-serif">${esc(e.data.label)}</text>` +
          `</g>`,
      );
    }
  }

  // ---- 绘制节点 ----
  const nodeParts: string[] = [];
  for (const l of layouts) {
    const n = l.node;
    const actor = effectiveActor(n, nodesById);
    const frame = ACTOR_META[actor].frame;
    const panel = n.data.composite ? pal.bgPanel2 : pal.bgPanel;
    const rx = n.data.composite ? 14 : 12;
    const dash = n.data.composite ? '8 6' : undefined;
    const x = sx(l.x);
    const y = sy(l.y);
    const w = l.w * scale;
    const h = l.h * scale;

    // 节点外框 + actor 光晕
    nodeParts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${panel}" stroke="${frame}" stroke-width="${(n.data.composite ? 3 : 2) * scale}"${dash ? ` stroke-dasharray="${dash}"` : ''} />`,
    );
    // header 分隔线
    const headerY = y + HEADER_H * scale;
    nodeParts.push(`<line x1="${x + 11 * scale}" y1="${headerY}" x2="${x + w - 11 * scale}" y2="${headerY}" stroke="${pal.border}" stroke-width="${scale}" />`);
    // 标题
    nodeParts.push(
      `<text x="${x + 11 * scale}" y="${y + 14 * scale}" font-size="${13 * scale}" font-weight="700" fill="${pal.text}" font-family="system-ui,sans-serif">${esc(n.data.label || '未命名节点')}</text>`,
    );
    // 描述
    if (n.data.description) {
      nodeParts.push(
        `<text x="${x + 11 * scale}" y="${y + (HEADER_H + 14) * scale}" font-size="${11.5 * scale}" fill="${pal.textDim}" font-family="system-ui,sans-serif">${esc(n.data.description)}</text>`,
      );
    }
    // 端口
    for (const p of l.ports) {
      const px = p.side === 'in' ? x : x + w;
      const py = y + p.y * scale;
      const isInput = p.side === 'in';
      const labelX = isInput ? px + 8 * scale : px - 8 * scale;
      const anchor = isInput ? 'start' : 'end';
      nodeParts.push(
        `<circle cx="${px}" cy="${py}" r="${5 * scale}" fill="${pal.accent}" stroke="${pal.border}" stroke-width="${1 * scale}" />`,
      );
      nodeParts.push(
        `<text x="${labelX}" y="${py}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${11 * scale}" fill="${pal.textDim}" font-family="system-ui,sans-serif">${esc(p.name)}</text>`,
      );
    }
  }

  // ---- 背景 + 点阵 ----
  const dotSize = 1 * scale;
  const dotGap = 24 * scale;
  const dots = `<pattern id="nf-dots" width="${dotGap}" height="${dotGap}" patternUnits="userSpaceOnUse"><circle cx="${dotSize}" cy="${dotSize}" r="${dotSize}" fill="${pal.dot}" /></pattern>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    `<defs>${dots}</defs>` +
    `<rect width="${outW}" height="${outH}" fill="${pal.bg}" />` +
    `<rect width="${outW}" height="${outH}" fill="url(#nf-dots)" />` +
    edgeParts.join('') +
    nodeParts.join('') +
    `</svg>`;

  return { svg, width: outW, height: outH };
}

/** 把 path 的坐标按 (sx, sy) 映射并缩放 */
function transformPath(path: string, sx: (x: number) => number, sy: (y: number) => number, scale: number): string {
  return path.replace(/([MLC])\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/gi, (_m, c: string, a: string, b: string) => {
    const x = parseFloat(a);
    const y = parseFloat(b);
    return `${c} ${sx(x)} ${sy(y)}`;
  });
}

/** 下载 SVG 文件 */
export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
