/**
 * Agent Interface — Screenshots(Visual Observe)。
 * Renderer 内运行,复用项目既有 html-to-image;不引入新截图框架。
 * Window 截图在 Electron 中优先走主进程 webContents.capturePage(避免 DOM 克隆失真)。
 */
import { toPng } from 'html-to-image';
import type { AgentScreenshot } from './types';

const WAIT_RAF = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => r());
  });

async function waitFrames(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) await WAIT_RAF();
}

/** 取 DOM 元素 png(data:base64,无前缀) */
async function pngOf(el: Element): Promise<AgentScreenshot> {
  const dataUrl = await toPng(el as HTMLElement, {
    cacheBust: true,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#17181c',
  });
  const data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const rect = el.getBoundingClientRect();
  return { format: 'png', mimeType: 'image/png', data, width: Math.round(rect.width), height: Math.round(rect.height) };
}

function windowScreenshotFromMain(): Promise<AgentScreenshot | null> {
  const api = (window as unknown as { nodeflow?: { agentCaptureWindow?: () => Promise<AgentScreenshot> } })
    .nodeflow?.agentCaptureWindow;
  if (typeof api !== 'function') return Promise.resolve(null);
  return api().catch(() => null);
}

export async function captureCanvasScreenshot(): Promise<AgentScreenshot> {
  await waitFrames();
  const el = document.querySelector<HTMLElement>('.react-flow');
  if (!el) throw new Error('未找到画布容器(.react-flow)');
  return pngOf(el);
}

export async function captureWindowScreenshot(): Promise<AgentScreenshot> {
  await waitFrames();
  const fromMain = await windowScreenshotFromMain();
  if (fromMain) return fromMain;
  // 非 Electron 环境(浏览器 dev)兜底:整页截图
  const el = document.body ?? document.documentElement;
  const shot = await pngOf(el);
  return shot;
}
