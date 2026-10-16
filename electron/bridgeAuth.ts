/**
 * Agent Bridge 鉴权纯函数(无 Electron 依赖,便于单测)。
 * 阻断 CSRF / DNS rebinding / 无密钥访问。
 */
import crypto from 'node:crypto';

/** Host 必须指向本机回环与当前端口(阻断 DNS rebinding) */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  let hostname: string;
  let portNum: number;
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close < 0) return false;
    hostname = host.slice(0, close + 1);
    const rest = host.slice(close + 1);
    portNum = rest.startsWith(':') ? Number(rest.slice(1)) : 80;
  } else {
    const idx = host.lastIndexOf(':');
    if (idx < 0) {
      hostname = host;
      portNum = 80;
    } else {
      hostname = host.slice(0, idx);
      portNum = Number(host.slice(idx + 1));
    }
  }
  if (!Number.isFinite(portNum) || portNum !== port) return false;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}

/**
 * 浏览器跨站请求会带 Origin。MCP / curl / 脚本通常不带。
 * 有 Origin 且不是 file:// 或 null 时视为浏览器请求 → 拒绝。
 */
export function isForbiddenOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const o = origin.trim();
  if (o === '' || o === 'null' || o === 'file://') return false;
  return true;
}

export function extractBearerToken(authorization: string | undefined, customToken?: string): string | null {
  if (typeof authorization === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (m) return m[1].trim();
  }
  if (typeof customToken === 'string' && customToken.trim()) return customToken.trim();
  return null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
