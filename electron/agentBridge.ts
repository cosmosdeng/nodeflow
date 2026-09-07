/**
 * Agent Local Test Bridge — Electron 主进程。
 *
 * 职责:只在本机 127.0.0.1 上提供 HTTP/JSON;请求经固定白名单 IPC channel
 * 转发给 renderer 的 Agent Core 执行,再把响应回传。
 *
 * 安全边界:
 * - NodeFlow next 默认自动启动(仅 127.0.0.1);可用 NODEFLOW_AGENT_BRIDGE=0 关闭;
 * - 只监听 127.0.0.1,绝不监听公网;
 * - 无 eval / 任意 JS / arbitrary IPC / filesystem / shell 暴露。
 */
import http from 'node:http';
import { BrowserWindow, ipcMain } from 'electron';

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

const PENDING = new Map<string, (resp: AgentBridgeResponse) => void>();
const TIMEOUT_MS = 30_000;

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
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function runInRenderer(req: AgentEnvelope, res: http.ServerResponse): void {
  forward(req, (resp) => respondJson(res, resp.success ? 200 : 200, resp));
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
  ipcMain.on('agent:bridge:response', (_e, resp: AgentBridgeResponse) => {
    if (!resp || typeof resp.requestId !== 'string') return;
    const p = PENDING.get(resp.requestId);
    if (!p) return;
    PENDING.delete(resp.requestId);
    p(resp);
  });
}

export function startAgentBridge(port = AGENT_DEFAULT_PORT): http.Server {
  registerBridgeIpcHandlers();

  const server = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    } catch {
      respondJson(res, 400, makeResponse('', false, undefined, { code: 'INVALID_REQUEST', message: 'URL 非法' }));
      return;
    }

    if (req.method === 'GET') {
      if (url.pathname === '/agent/v1/health') {
        respondJson(res, 200, { status: 'ok', agentBridge: true });
        return;
      }
      const qtype = pathQueryType(url.pathname);
      if (!qtype) {
        respondJson(res, 404, makeResponse('', false, undefined, { code: 'INVALID_REQUEST', message: `未知路径 ${url.pathname}` }));
        return;
      }
      const id = `http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      runInRenderer({ protocolVersion: AGENT_PROTOCOL_VERSION, requestId: id, type: qtype }, res);
      return;
    }

    if (req.method === 'POST') {
      const path = url.pathname;
      if (path === '/agent/v1/command' || path === '/agent/v1/assert') {
        void parseBody(req)
          .then((body) => {
            const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
            const protocolVersion =
              typeof o.protocolVersion === 'string' ? o.protocolVersion : AGENT_PROTOCOL_VERSION;
            const requestId =
              typeof o.requestId === 'string' && o.requestId ? o.requestId : `http_${Date.now()}`;
            const rawType = typeof o.type === 'string' ? o.type : '';
            const type = path === '/agent/v1/assert' ? 'assert' : rawType;
            // assert:外层 payload 或整体 body 中应含 {type: assertNodeExists, ...};不把请求信封本身当 payload
            const payload =
              path === '/agent/v1/assert'
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
            respondJson(
              res,
              400,
              makeResponse('', false, undefined, { code: 'INVALID_REQUEST', message: e instanceof Error ? e.message : String(e) }),
            );
          });
        return;
      }
      respondJson(res, 404, makeResponse('', false, undefined, { code: 'INVALID_REQUEST', message: `未知路径 ${path}` }));
      return;
    }

    respondJson(res, 405, makeResponse('', false, undefined, { code: 'INVALID_REQUEST', message: '仅支持 GET/POST' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[Agent Bridge] listening on http://127.0.0.1:${port} (local test only)`);
  });
  server.on('error', (e) => {
    console.error(`[Agent Bridge] start failed: ${e.message}`);
  });
  return server;
}
