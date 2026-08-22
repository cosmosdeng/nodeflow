import { toJpeg, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';

export type ExportImageFormat = 'jpeg' | 'pdf' | 'svg';

/** 常见纸张幅面(横版,96dpi 像素宽高);fit 表示按完整画布自动适配 */
export interface PaperSize {
  key: string;
  label: string;
  /** 像素宽(0 表示自动适配完整画布) */
  width: number;
  /** 像素高 */
  height: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { key: 'fit', label: '完整画布', width: 0, height: 0 },
  { key: 'a5', label: 'A5', width: 794, height: 559 },
  { key: 'a4', label: 'A4', width: 1123, height: 794 },
  { key: 'a3', label: 'A3', width: 1587, height: 1123 },
  { key: 'letter', label: 'Letter', width: 1056, height: 816 },
];

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const waitFrames = async (n = 3) => {
  for (let i = 0; i < n; i++) await raf();
};

interface RfLike {
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (v: { x: number; y: number; zoom: number }) => void;
  fitView: (opts?: Record<string, unknown>) => Promise<boolean> | Promise<void> | void;
}

/** 可见节点的内容包围盒(流坐标) */
export interface NodesBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

/** 计算使内容(bounds)按 scale 缩放后在画布内上下左右居中的 transform */
function fitTransform(
  bounds: NodesBounds,
  scale: number,
  canvasW: number,
  canvasH: number,
) {
  const cx = canvasW / 2 - (bounds.left + bounds.width / 2) * scale;
  const cy = canvasH / 2 - (bounds.top + bounds.height / 2) * scale;
  return `translate(${cx}px, ${cy}px) scale(${scale})`;
}

/**
 * 将连线 SVG 内依赖 CSS 变量的关键样式(如 stroke)内联到元素上,
 * 避免 html-to-image 克隆到 foreignObject 后 CSS 变量作用域丢失导致连线不可见。
 * 返回一个恢复函数,用于截图后清除这些临时内联样式。
 */
function inlineSvgStyles(root: ParentNode): () => void {
  const els = Array.from(
    root.querySelectorAll<SVGElement & HTMLElement>(
      '.react-flow__edge-path, .react-flow__connection-path, .react-flow__edge text, .react-flow__edge .edge-label',
    ),
  );
  const restores: Array<{ el: HTMLElement; prop: string; prev: string }> = [];
  for (const el of els) {
    const htmlEl = el as unknown as HTMLElement;
    const cs = getComputedStyle(el);
    // 把计算后的颜色/宽度内联,确保克隆后可见
    if (cs.stroke && cs.stroke !== 'none') {
      restores.push({ el: htmlEl, prop: 'stroke', prev: htmlEl.style.stroke });
      htmlEl.style.stroke = cs.stroke;
    }
    if (cs.strokeWidth) {
      restores.push({ el: htmlEl, prop: 'strokeWidth', prev: htmlEl.style.strokeWidth });
      htmlEl.style.strokeWidth = cs.strokeWidth;
    }
    if (cs.fill && cs.fill !== 'none') {
      restores.push({ el: htmlEl, prop: 'fill', prev: htmlEl.style.fill });
      htmlEl.style.fill = cs.fill;
    }
  }
  return () => {
    for (const r of restores) r.el.style.setProperty(r.prop, r.prev);
  };
}

/**
 * 导出画布为 JPG / PDF / SVG。
 * - 隐藏 MiniMap / Controls / 面板等 UI 后再截图,避免混入
 * - 计算所有节点包围盒,按所选幅面(含边距)缩放适配,默认横版
 * - 截图后恢复视口与 UI
 */
export async function exportCanvasImage(
  rf: RfLike,
  format: ExportImageFormat,
  paper: PaperSize,
  bounds: NodesBounds,
): Promise<void> {
  const container = document.querySelector<HTMLElement>('.react-flow');
  if (!container) throw new Error('未找到画布容器');
  const viewport = container.querySelector<HTMLElement>('.react-flow__viewport');
  const prevViewport = rf.getViewport();
  const prevTransform = viewport?.style.transform;

  // 需要隐藏的 UI 元素(全局缩略图 / 控件 / 面板 / 操作提示);保留点阵背景以还原画布风格
  const uiEls = Array.from(
    container.querySelectorAll<HTMLElement>(
      '.react-flow__minimap, .react-flow__controls, .react-flow__panel, .nf-hint',
    ),
  );
  const prevDisplay = uiEls.map((el) => el.style.display);
  uiEls.forEach((el) => (el.style.display = 'none'));

  const baseName = `nodeflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const isFit = paper.width === 0;
  // 记录容器原始内联尺寸(截图后恢复)
  const prevSize = { w: container.style.width, h: container.style.height };
  // 内联连线关键样式,防止 CSS 变量在克隆时丢失
  const restoreSvg = inlineSvgStyles(container);

  try {
    // 输出像素尺寸(保留边距)
    const margin = 0.06; // 边距比例
    const outW = isFit ? container.clientWidth : paper.width;
    const outH = isFit ? container.clientHeight : paper.height;
    const padX = Math.round(outW * margin);
    const padY = Math.round(outH * margin);

    // 内容可用区域
    const availW = outW - padX * 2;
    const availH = outH - padY * 2;

    // 适配缩放:让节点包围盒按比例缩放到可用区域内
    const cw = bounds.width > 0 ? bounds.width : 1;
    const ch = bounds.height > 0 ? bounds.height : 1;
    const scale = Math.min(availW / cw, availH / ch);

    // 对 viewport 施加适配 transform:所有节点按幅面缩放后上下左右居中
    if (viewport) {
      viewport.style.transform = fitTransform(bounds, scale, outW, outH);
    }
    // 临时把画布容器设为幅面尺寸,使背景/点阵铺满整个导出幅面
    container.style.width = `${outW}px`;
    container.style.height = `${outH}px`;
    await waitFrames();

    // 截图目标:整个画布容器(含节点/连线/点阵背景),保留原画布风格
    const target = container;

    // 导出选项:按元素实际尺寸输出(背景铺满),物理像素 2 倍提升清晰度。
    // 不强制背景色,让画布自身的背景(深色/浅色)与点阵背景原样保留。
    const imgOpts = {
      pixelRatio: 2,
      quality: format === 'jpeg' ? 0.95 : 0.92,
      skipFonts: true,
    };

    if (format === 'svg') {
      const dataUrl = await toSvg(target, imgOpts);
      downloadDataUrl(dataUrl, `${baseName}.svg`);
    } else if (format === 'jpeg') {
      const dataUrl = await toJpeg(target, imgOpts);
      downloadDataUrl(dataUrl, `${baseName}.jpg`);
    } else if (format === 'pdf') {
      const dataUrl = await toJpeg(target, { ...imgOpts, quality: 0.92 });
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const pageMm = isFit
        ? { w: 297, h: (297 * img.height) / img.width }
        : { w: (paper.width / 96) * 25.4, h: (paper.height / 96) * 25.4 };
      const pdf = new jsPDF({
        orientation: pageMm.w >= pageMm.h ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageMm.w, pageMm.h],
      });
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pageMm.w, pageMm.h);
      pdf.save(`${baseName}.pdf`);
    }
  } finally {
    uiEls.forEach((el, i) => (el.style.display = prevDisplay[i]));
    if (viewport && prevTransform !== undefined) viewport.style.transform = prevTransform;
    container.style.width = prevSize.w;
    container.style.height = prevSize.h;
    restoreSvg();
    rf.setViewport(prevViewport);
  }
}
