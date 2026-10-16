import { describe, expect, it } from 'vitest';
import rootPkg from '../../../package.json';
import mcpPkg from '../../../mcp-server/package.json';

describe('版本单一来源', () => {
  it('根 package.json 与 mcp-server/package.json 版本一致', () => {
    expect(mcpPkg.version).toBe(rootPkg.version);
  });

  it('版本号遵循 semver + prerelease 标记', () => {
    expect(rootPkg.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it('productName / name 稳定', () => {
    expect(rootPkg.name).toBe('nodeflow');
    expect(mcpPkg.name).toBe('@cosmosdeng/nodeflow-mcp');
  });
});
