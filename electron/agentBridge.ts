/**
 * Agent Local Test Bridge — Electron 主进程。
 *
 * 职责:只在本机 127.0.0.1 上提供 HTTP/JSON;请求经固定白名单 IPC channel
 * 转发给 renderer 的 Agent Core 执行,再把响应回传。
 *
 * 安全边界:
 * - 仅监听 127.0.0.1,绝不监听公网;
 * - 强制共享密钥(Authorization: Bearer / X-NodeFlow-Token),无密钥拒绝一切非 health 请求;
 * - 校验 Host 必须为 127.0.0.1/localhost:<port>,阻断 DNS rebinding;
 * - 拒绝浏览器 Origin(无 Origin 或非浏览器客户端才放行),阻断 CSRF;
 * - 要求 X-NodeFlow-Agent: 1 自定义头,阻断简单跨站表单/文本请求;
 * - 无 eval / 任意 JS / arbitrary IPC / filesystem / shell 暴露。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import {
  extractBearerToken,
  isAllowedHost,
  isForbiddenOrigin,
  timingSafeEqual,
} from './bridgeAuth';

export interface AgentEnvelope {
  protocolVersion: string;
  requestId: string;
  type: string;
  payload?: unknown;
}

export interface AgentBridgeResponse {
  protocolVersion: string;
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export const AGENT_PROTOCOL_VERSION = '1';
export const AGENT_DEFAULT_PORT = 8787;
export const AGENT_TOKEN_FILE = path.join(os.homedir(), '.nodeflow', 'agent-bridge.json');

const PENDING = new Map<string, (resp: AgentBridgeResponse) => void>();
const TIMEOUT_MS = 30_000;

export interface AgentBridgeOptions {
  port?: number;
  /** 显式提供 token;不提供则从 env / token 文件读取,再没有则生成并落盘 */
  token?: string;
}

export interface AgentBridgeHandle {
  server: http.Server;
  port: number;
  token: string;
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function makeResponse(
  requestId: string,
  success: boolean,
  data?: unknown,
  error?: AgentBridgeResponse['error'],
): AgentBridgeResponse {
  return { protocolVersion: AGENT_PROTOCOL_VERSION, requestId, success, data, error };
}

function readyWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return null;
  return win;
}

function forward(req: AgentEnvelope, cb: (resp: AgentBridgeResponse) => void): void {
  const win = readyWindow();
  if (!win) {
    cb(makeResponse(req.requestId, false, undefined, { code: 'INTERNAL', message: '没有可用的渲染窗口' }));
    return;
  }
  if (win.webContents.isLoading()) {
    cb(makeResponse(req.requestId, false, undefined, { code: 'INTERNAL', message: '渲染器尚未就绪,请稍后重试' }));
    return;
  }
  if (PENDING.has(req.requestId)) {
    cb(makeResponse(req.requestId, false, undefined, { code: 'INVALID_REQUEST', message: `requestId 冲突: ${req.requestId}` }));
    return;
  }
  PENDING.set(req.requestId, cb);
  win.webContents.send('agent:bridge:request', req);
  setTimeout(() => {
    const p = PENDING.get(req.requestId);
    if (p) {
      PENDING.delete(req.requestId);
      p(makeResponse(req.requestId, false, undefined, { code: 'INTERNAL', message: 'Agent Bridge 请求超时' }));
    }
  }, TIMEOUT_MS).unref();
}

function pathQueryType(pathname: string): string | null {
  const map: Record<string, string> = {
    '/agent/v1/state': 'getGraphState',
    '/agent/v1/nodes': 'getNodes',
    '/agent/v1/edges': 'getEdges',
    '/agent/v1/participants': 'getParticipants',
    '/agent/v1/stages': 'getStages',
    '/agent/v1/viewport': 'getViewport',
    '/agent/v1/selection': 'getSelection',
  };
  if (pathname in map) return map[pathname];
  if (pathname === '/agent/v1/document') return 'getDocument';
  if (pathname === '/agent/v1/screenshot/canvas') return 'getCanvasScreenshot';
  if (pathname === '/agent/v1/screenshot/window') return 'getWindowScreenshot';
  return null;
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function runInRenderer(req: AgentEnvelope, res: http.ServerResponse): void {
  forward(req, (resp) => respondJson(res, resp.success ? 200 : 200, resp));
}

function extractToken(req: http.IncomingMessage): string | null {
  const custom = req.headers['x-nodeflow-token'];
  return extractBearerToken(
    typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    typeof custom === 'string' ? custom : undefined,
  );
}

function writeTokenFile(token: string, port: number): void {
  const dir = path.dirname(AGENT_TOKEN_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    AGENT_TOKEN_FILE,
    JSON.stringify({ token, port, pid: process.pid, at: Date.now() }, null, 2),
    { mode: 0o600 },
  );
}

/** 解析共享密钥:env 优先,其次 token 文件,最后生成新 token */
export function resolveAgentToken(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const fromEnv = process.env.NODEFLOW_AGENT_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const raw = fs.readFileSync(AGENT_TOKEN_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { token?: string };
    if (parsed.token && typeof parsed.token === 'string') return parsed.token;
  } catch {
    /* 文件不存在/损坏则生成新 token */
  }
  return crypto.randomBytes(24).toString('hex');
}

export function registerBridgeIpcHandlers(): void {
  // 整窗截图:主进程 webContents.capturePage(比 DOM 克隆更可靠)
  ipcMain.handle('agent:capture-window', async (event) => {
    try {
      const contents = event.sender;
      const image = await contents.capturePage();
      const size = image.getSize();
      return {
        format: 'png',
        mimeType: 'image/png',
        data: image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
      };
    } catch (e) {
      throw new Error(`窗口截图失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  ipcMain.on('agent:bridge:response', (event, resp: AgentBridgeResponse) => {
    if (!resp || typeof resp.requestId !== 'string') return;
    // 仅接受本窗口发回的响应
    const win = readyWindow();
    if (!win || event.sender.id !== win.webContents.id) return;
    const p = PENDING.get(resp.requestId);
    if (!p) return;
    PENDING.delete(resp.requestId);
    p(resp);
  });
}

export function startAgentBridge(options: AgentBridgeOptions = {}): AgentBridgeHandle {
  const port = options.port ?? AGENT_DEFAULT_PORT;
  const token = resolveAgentToken(options.token);
  writeTokenFile(token, port);
  registerBridgeIpcHandlers();

  const server = http.createServer((req, res) => {
    const reject = (status: number, code: string, message: string) => {
      respondJson(res, status, makeResponse('', false, undefined, { code, message }));
    };

    if (!isAllowedHost(req.headers.host, port)) {
      reject(403, 'FORBIDDEN', 'Host 校验失败(仅允许 127.0.0.1/localhost 本机访问)');
      return;
    }
    if (isForbiddenOrigin(req.headers.origin)) {
      reject(403, 'FORBIDDEN', '拒绝跨源 Origin 请求');
      return;
    }
    if (req.headers['x-nodeflow-agent'] !== '1') {
      reject(403, 'FORBIDDEN', '缺少 X-NodeFlow-Agent: 1 头');
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    } catch {
      reject(400, 'INVALID_REQUEST', 'URL 非法');
      return;
    }

    // health 允许无 token(探活);其余端点一律要求密钥
    const isHealth = req.method === 'GET' && url.pathname === '/agent/v1/health';
    if (!isHealth) {
      const provided = extractToken(req);
      if (!provided || !timingSafeEqual(provided, token)) {
        reject(401, 'UNAUTHORIZED', '缺少或无效的 Agent Bridge token');
        return;
      }
    }

    if (req.method === 'GET') {
      if (isHealth) {
        respondJson(res, 200, { status: 'ok', agentBridge: true });
        return;
      }
      const qtype = pathQueryType(url.pathname);
      if (!qtype) {
        reject(404, 'INVALID_REQUEST', `未知路径 ${url.pathname}`);
        return;
      }
      const id = `http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      runInRenderer({ protocolVersion: AGENT_PROTOCOL_VERSION, requestId: id, type: qtype }, res);
      return;
    }

    if (req.method === 'POST') {
      const pathName = url.pathname;
      if (pathName === '/agent/v1/command' || pathName === '/agent/v1/assert') {
        void parseBody(req)
          .then((body) => {
            const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
            const protocolVersion =
              typeof o.protocolVersion === 'string' ? o.protocolVersion : AGENT_PROTOCOL_VERSION;
            const requestId =
              typeof o.requestId === 'string' && o.requestId ? o.requestId : `http_${Date.now()}`;
            const rawType = typeof o.type === 'string' ? o.type : '';
            const type = pathName === '/agent/v1/assert' ? 'assert' : rawType;
            const payload =
              pathName === '/agent/v1/assert'
                ? o.payload !== undefined
                  ? o.payload
                  : { type: rawType, ...o }
                : o.payload;
            runInRenderer(
              { protocolVersion, requestId, type: type || 'unknown', payload },
              res,
            );
          })
          .catch((e) => {
            reject(400, 'INVALID_REQUEST', e instanceof Error ? e.message : String(e));
          });
        return;
      }
      reject(404, 'INVALID_REQUEST', `未知路径 ${pathName}`);
      return;
    }

    reject(405, 'INVALID_REQUEST', '仅支持 GET/POST');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[Agent Bridge] listening on http://127.0.0.1:${port} (token required)`);
    console.log(`[Agent Bridge] token file: ${AGENT_TOKEN_FILE}`);
  });
  server.on('error', (e) => {
    console.error(`[Agent Bridge] start failed: ${e.message}`);
  });
  return { server, port, token };
}
