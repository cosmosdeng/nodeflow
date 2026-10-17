import { describe, expect, it } from 'vitest';
import { buildSvg } from '../exportSvg';
import { PAPER_SIZES } from '../exportImage';
import type { FlowEdge, FlowNode } from '../../types';

function node(id: string, x: number, y: number, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type: 'flow',
    position: { x, y },
    data: {
      label: id,
      actor: 'machine',
      locked: false,
      inputs: [{ id: 'in1', name: 'in' }],
      outputs: [{ id: 'out1', name: 'out' }],
    },
    ...extra,
  } as FlowNode;
}

function edge(id: string, source: string, target: string): FlowEdge {
  return {
    id,
    source,
    sourceHandle: 'out1',
    target,
    targetHandle: 'in1',
    type: 'flow',
    data: { label: '', artifact: null },
  } as FlowEdge;
}

const bounds = { left: 0, top: 0, width: 400, height: 200 };
const fit = PAPER_SIZES.find((p) => p.key === 'fit')!;
const a4 = PAPER_SIZES.find((p) => p.key === 'a4')!;

describe('buildSvg', () => {
  it('生成合法 SVG 根元素与视口尺寸', () => {
    const r = buildSvg([node('A', 0, 0)], [], 'dark', fit, bounds);
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg).toContain('</svg>');
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('包含节点 label 文本', () => {
    const r = buildSvg([node('A', 10, 10)], [], 'dark', fit, bounds);
    expect(r.svg).toContain('A');
  });

  it('连线生成 path 元素', () => {
    const r = buildSvg([node('A', 0, 0), node('B', 200, 0)], [edge('e1', 'A', 'B')], 'dark', fit, bounds);
    expect(r.svg).toContain('<path');
    expect(r.svg).toContain('<text');
  });

  it('hidden 节点不导出', () => {
    const r = buildSvg([node('A', 0, 0), node('B', 100, 0, { hidden: true })], [], 'dark', fit, bounds);
    expect(r.svg).not.toContain('>B<');
    expect(r.svg).toContain('>A<');
  });

  it('固定 A4 幅面使用给定宽高', () => {
    const r = buildSvg([node('A', 0, 0)], [], 'light', a4, bounds);
    expect(r.width).toBe(a4.width);
    expect(r.height).toBe(a4.height);
  });

  it('深色/浅色主题输出不同配色', () => {
    const dark = buildSvg([node('A', 0, 0)], [], 'dark', fit, bounds);
    const light = buildSvg([node('A', 0, 0)], [], 'light', fit, bounds);
    expect(dark.svg).toContain('#17181c');
    expect(light.svg).toContain('#f4f5f8');
    expect(dark.svg).not.toBe(light.svg);
  });

  it('label 中的 HTML 字符被转义', () => {
    const n = node('A', 0, 0);
    n.data.label = '<script>alert(1)</script>';
    const r = buildSvg([n], [], 'dark', fit, bounds);
    expect(r.svg).not.toContain('<script>');
    expect(r.svg).toContain('&lt;script&gt;');
  });

  it('空图不崩溃', () => {
    const r = buildSvg([], [], 'dark', fit, bounds);
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(Number.isFinite(r.width)).toBe(true);
  });

  it('PAPER_SIZES 含 fit 与常见纸张', () => {
    const keys = PAPER_SIZES.map((p) => p.key);
    expect(keys).toContain('fit');
    expect(keys).toContain('a4');
    expect(keys).toContain('a3');
    expect(keys).toContain('letter');
  });
});
