import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * 组件测试(jsdom)环境准备。
 *
 * jsdom 没有实现一批浏览器 API,而 React Flow / 本项目组件依赖它们,统一在此补齐:
 * - ResizeObserver:React Flow 用它测量节点尺寸,缺失会导致节点尺寸恒为 0;
 * - DOMMatrixReadOnly:d3-zoom 读变换矩阵(m22 为缩放),缺失会导致视口计算崩溃;
 * - getBoundingClientRect:jsdom 默认返回全 0,让 React Flow 误判元素不可见;
 * - getBBox:SVG 文本测量;
 * - innerText:jsdom **完全未实现**(只实现 textContent),而 EditableText 依赖它读写
 *   编辑内容;这里把它映射到 textContent,使组件在测试中行为与浏览器一致。
 */

const MOCK_SIZE = { width: 230, height: 120 };

/**
 * jsdom 无真实布局:必须在 observe 时**立即以固定尺寸回调**,否则 React Flow 永远等不到
 * 节点测量完成(nodesInitialized 为 false),连线与端口位置一律不渲染。
 */
class MockResizeObserver implements ResizeObserver {
  private readonly cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: MOCK_SIZE.width,
      bottom: MOCK_SIZE.height,
      width: MOCK_SIZE.width,
      height: MOCK_SIZE.height,
      toJSON: () => ({}),
    } as unknown as DOMRectReadOnly;
    this.cb([{ target, contentRect: rect } as unknown as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = MockResizeObserver;

// React Flow 读 offsetWidth / offsetHeight 测量节点,jsdom 恒返回 0
for (const [prop, value] of [
  ['offsetWidth', MOCK_SIZE.width],
  ['offsetHeight', MOCK_SIZE.height],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => value,
  });
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  class MockDOMMatrixReadOnly {
    readonly m22 = 1;
  }
  Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
    value: MockDOMMatrixReadOnly,
    writable: true,
    configurable: true,
  });
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    top: 0,
    left: 0,
    right: 200,
    bottom: 100,
    toJSON: () => ({}),
  } as DOMRect;
};

// getBBox 在 TS 的 SVGElement 类型上未声明(实际在 SVGGraphicsElement 上),经中间类型断言补齐
type BBoxHost = { getBBox?: () => DOMRect };
const svgProto = SVGElement.prototype as unknown as BBoxHost;
if (!svgProto.getBBox) {
  svgProto.getBBox = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

// jsdom 未实现 scrollIntoView(类型上是存在的,故不做 in 检查,直接覆盖)
Element.prototype.scrollIntoView = function scrollIntoView(): void {};

if (!('innerText' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement): string {
      return this.textContent ?? '';
    },
    set(this: HTMLElement, v: string) {
      this.textContent = v;
    },
  });
}

// 每个用例后自动卸载组件、清理 DOM
afterEach(() => {
  cleanup();
});
