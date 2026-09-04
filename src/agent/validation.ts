/**
 * Agent Interface — runtime validation helpers(所有来自 HTTP 的输入均不可信)。
 * 不用 `any`;unknown → 逐字段校验 → typed DTO。
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(v)) {
    throw invalidPayload(`${path} 必须是对象`);
  }
  return v;
}

export function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') throw invalidPayload(`${path} 必须是字符串`);
  return v;
}

export function asOptionalString(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return asString(v, path);
}

export function asNullableString(v: unknown, path: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return asString(v, path);
}

export function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalidPayload(`${path} 必须是数字`);
  return v;
}

export function asOptionalNumber(v: unknown, path: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  return asNumber(v, path);
}

export function asBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw invalidPayload(`${path} 必须是布尔值`);
  return v;
}

export function asStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw invalidPayload(`${path} 必须是字符串数组`);
  }
  return v;
}

export function asPosition(v: unknown): { x: number; y: number } {
  const o = asRecord(v, 'position');
  return { x: asNumber(o.x, 'position.x'), y: asNumber(o.y, 'position.y') };
}

export function asOptionalPosition(v: unknown): { x: number; y: number } | undefined {
  if (v === undefined || v === null) return undefined;
  return asPosition(v);
}

export function asAgentRequest(body: unknown): {
  protocolVersion: string;
  requestId: string;
  type: string;
  payload: unknown;
} {
  const o = asRecord(body, 'request');
  const protocolVersion = asString(o.protocolVersion, 'request.protocolVersion');
  const requestId = asString(o.requestId, 'request.requestId');
  if (!requestId.trim()) throw invalidPayload('request.requestId 不能为空');
  const type = asString(o.type, 'request.type');
  return { protocolVersion, requestId, type, payload: o.payload };
}

export function asPayloadRecord(v: unknown): Record<string, unknown> {
  return asRecord(v, 'payload');
}

export interface PayloadValidationError extends Error {
  code: 'INVALID_PAYLOAD';
}

export function invalidPayload(message: string): PayloadValidationError {
  const err = new Error(message) as PayloadValidationError;
  err.code = 'INVALID_PAYLOAD';
  return err;
}
