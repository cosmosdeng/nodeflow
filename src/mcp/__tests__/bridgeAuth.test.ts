import { describe, expect, it } from 'vitest';
import { extractBearerToken, isAllowedHost, isForbiddenOrigin, timingSafeEqual } from '../../../electron/bridgeAuth';

describe('Agent Bridge 鉴权', () => {
  describe('isAllowedHost (DNS rebinding 防护)', () => {
    it('允许 127.0.0.1:port / localhost:port', () => {
      expect(isAllowedHost('127.0.0.1:8787', 8787)).toBe(true);
      expect(isAllowedHost('localhost:8787', 8787)).toBe(true);
      expect(isAllowedHost('[::1]:8787', 8787)).toBe(true);
    });

    it('拒绝错误端口', () => {
      expect(isAllowedHost('127.0.0.1:9999', 8787)).toBe(false);
      expect(isAllowedHost('127.0.0.1', 8787)).toBe(false); // 默认 80
    });

    it('拒绝外部主机名(DNS rebinding)', () => {
      expect(isAllowedHost('evil.example.com:8787', 8787)).toBe(false);
      expect(isAllowedHost('attacker.local:8787', 8787)).toBe(false);
    });

    it('拒绝缺失 Host', () => {
      expect(isAllowedHost(undefined, 8787)).toBe(false);
      expect(isAllowedHost('', 8787)).toBe(false);
    });
  });

  describe('isForbiddenOrigin (CSRF 防护)', () => {
    it('允许无 Origin / null / file://', () => {
      expect(isForbiddenOrigin(undefined)).toBe(false);
      expect(isForbiddenOrigin('')).toBe(false);
      expect(isForbiddenOrigin('null')).toBe(false);
      expect(isForbiddenOrigin('file://')).toBe(false);
    });

    it('拒绝浏览器 http(s) Origin', () => {
      expect(isForbiddenOrigin('https://evil.example.com')).toBe(true);
      expect(isForbiddenOrigin('http://localhost:5173')).toBe(true);
      expect(isForbiddenOrigin('https://github.com')).toBe(true);
    });
  });

  describe('extractBearerToken', () => {
    it('解析 Authorization: Bearer', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123');
      expect(extractBearerToken('bearer abc123')).toBe('abc123');
    });

    it('解析 X-NodeFlow-Token 备选头', () => {
      expect(extractBearerToken(undefined, 'tok')).toBe('tok');
      expect(extractBearerToken('Basic zzz', 'tok')).toBe('tok');
    });

    it('无 token 返回 null', () => {
      expect(extractBearerToken(undefined)).toBe(null);
      expect(extractBearerToken('Basic zzz')).toBe(null);
    });
  });

  describe('timingSafeEqual', () => {
    it('相同 token 通过，不同/长度不同拒绝', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
      expect(timingSafeEqual('abc', 'abd')).toBe(false);
      expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    });
  });
});
