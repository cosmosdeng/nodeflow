import { describe, expect, it } from 'vitest';
import {
  buildProjectDocumentV4,
  CURRENT_PROJECT_VERSION,
  detectDocumentFormat,
  futureVersionMessage,
  importLegacyExportToDocument,
  migrateProjectV2ToDocument,
  migrateProjectV3ToDocument,
  validateDocumentData,
} from '../document';

describe('lib/document 文档兼容层', () => {
  describe('format detection', () => {
    it('识别正式 Project v4', () => {
      const info = detectDocumentFormat({ format: 'nodeflow', version: CURRENT_PROJECT_VERSION, document: {} });
      expect(info.family).toBe('project');
      expect(info.version).toBe(CURRENT_PROJECT_VERSION);
      expect(info.legacy).toBe(false);
      expect(info.future).toBe(false);
    });

    it('识别 Legacy Project v3(version < current)', () => {
      const info = detectDocumentFormat({ format: 'nodeflow', version: 3, document: {} });
      expect(info.family).toBe('project');
      expect(info.legacy).toBe(true);
      expect(info.future).toBe(false);
    });

    it('识别 Legacy Project v2(type:nodeflow-project)', () => {
      const info = detectDocumentFormat({ type: 'nodeflow-project', version: 2, project: {} });
      expect(info.family).toBe('project');
      expect(info.version).toBe(2);
      expect(info.legacy).toBe(true);
      expect(info.future).toBe(false);
    });

    it('识别 Export format', () => {
      const info = detectDocumentFormat({ format: 'nodeflow-export', version: 1 });
      expect(info.family).toBe('export');
      expect(info.future).toBe(false);
    });

    it('识别平铺 Legacy Export v1(无 format/type)', () => {
      const info = detectDocumentFormat({ version: 1, nodes: [], edges: [] });
      expect(info.family).toBe('export');
      expect(info.legacy).toBe(true);
    });

    it('future project version 标记为 future', () => {
      const info = detectDocumentFormat({ format: 'nodeflow', version: 99, document: {} });
      expect(info.family).toBe('project');
      expect(info.future).toBe(true);
    });

    it('非法输入识别为 unknown', () => {
      expect(detectDocumentFormat(null).family).toBe('unknown');
      expect(detectDocumentFormat('x').family).toBe('unknown');
      expect(detectDocumentFormat({ format: 'weird' }).family).toBe('unknown');
    });
  });

  describe('future version gate', () => {
    it('future 消息给出明确提示', () => {
      const info = detectDocumentFormat({ format: 'nodeflow', version: CURRENT_PROJECT_VERSION + 1 });
      expect(futureVersionMessage(info)).toContain('升级 NodeFlow');
    });
  });

  describe('migrateProjectV2ToDocument', () => {
    it('把 v2 project 迁移为当前文档(剥离历史/dirty/React Flow 字段)', () => {
      const v2 = {
        type: 'nodeflow-project',
        version: 2,
        project: {
          name: '项目A',
          color: '#ff0000',
          nodes: [{ id: 'A', data: { composite: undefined }, selected: true, measured: { width: 10, height: 10 }, hidden: false, draggable: false }],
          edges: [{ id: 'e1', source: 'A', target: 'B', selected: true }],
          viewport: { x: 1, y: 2, zoom: 0.5 },
          annotations: [{ id: 'a1' }],
          stages: [{ id: 's1' }],
          compositeTabs: ['main'],
          activeTabId: 'main',
          past: [{ nodes: [] }],
          future: [],
          dirty: true,
        },
      };
      const doc = migrateProjectV2ToDocument(v2);
      // 历史/脏标记不进入
      expect('past' in doc).toBe(false);
      expect('dirty' in doc).toBe(false);
      // React Flow 字段被剥离
      expect(doc.nodes[0].selected).toBeUndefined();
      expect(doc.nodes[0].measured).toBeUndefined();
      expect(doc.edges[0].selected).toBeUndefined();
      // 数据保留
      expect(doc.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
      expect(doc.activeTabId).toBe('main');
    });

    it('migration 是 deterministic 且不修改输入', () => {
      const input = { type: 'nodeflow-project', version: 2, project: { nodes: [], edges: [] } };
      const a = migrateProjectV2ToDocument(input);
      const b = migrateProjectV2ToDocument(input);
      expect(a).toEqual(b);
      expect(input).toEqual({ type: 'nodeflow-project', version: 2, project: { nodes: [], edges: [] } });
    });

    it('缺失可选字段使用安全默认值', () => {
      const doc = migrateProjectV2ToDocument({ type: 'nodeflow-project', version: 2, project: { nodes: [], edges: [] } });
      expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(doc.activeTabId).toBe('main');
      expect(doc.compositeTabs).toEqual([]);
    });
  });

  describe('importLegacyExportToDocument', () => {
    it('把 v1 export 导入为当前文档', () => {
      const v1 = { version: 1, nodes: [{ id: 'A' }], edges: [], viewport: { x: 3, y: 4, zoom: 2 }, annotations: [], stages: [] };
      const doc = importLegacyExportToDocument(v1);
      expect(doc.nodes.map((n) => n.id)).toEqual(['A']);
      expect(doc.viewport).toEqual({ x: 3, y: 4, zoom: 2 });
      expect(doc.activeTabId).toBe('main');
    });
  });

  describe('validateDocumentData', () => {
    it('合法文档无问题', () => {
      const doc = migrateProjectV2ToDocument({ type: 'nodeflow-project', version: 2, project: { nodes: [], edges: [] } });
      expect(validateDocumentData(doc)).toEqual([]);
    });

    it('nodes/edges/annotations/stages 均为数组时通过', () => {
      const ok: Parameters<typeof validateDocumentData>[0] = {
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, annotations: [], stages: [], compositeTabs: [], activeTabId: 'main',
      };
      expect(validateDocumentData(ok)).toEqual([]);
    });

    it('viewport 非法时报错', () => {
      const doc = migrateProjectV2ToDocument({ type: 'nodeflow-project', version: 2, project: { nodes: [], edges: [] } });
      const bad = validateDocumentData({ ...doc, viewport: { x: 0, y: 0, zoom: 'x' as unknown as number } });
      expect(bad.some((i) => i.field === 'viewport')).toBe(true);
    });
  });

  describe('v4 持久化 / 迁移', () => {
    it('buildProjectDocumentV4:包含 participants/organizations,不含历史/脏标记', () => {
      const doc = buildProjectDocumentV4({
        name: 'P',
        color: '#ff0000',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        annotations: [],
        stages: [],
        participants: [{ id: 'p1', name: 'Artist', type: 'person' }],
        organizations: [{ id: 'o1', name: 'Dept' }],
        compositeTabs: [],
        activeTabId: 'main',
      });
      expect(doc.participants).toEqual([{ id: 'p1', name: 'Artist', type: 'person' }]);
      expect(doc.organizations).toEqual([{ id: 'o1', name: 'Dept' }]);
      expect('past' in doc).toBe(false);
      expect('dirty' in doc).toBe(false);
    });

    it('buildProjectDocumentV4:剥离 React Flow 运行时字段,保留 participantId', () => {
      const doc = buildProjectDocumentV4({
        name: 'P', color: '#ff0000', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
        annotations: [], stages: [], participants: [], organizations: [], compositeTabs: [], activeTabId: 'main',
      });
      const graph = doc.graph as { nodes: unknown[]; edges: unknown[] };
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('migrateProjectV3ToDocument:v3 → v4(participants 迁移为空),数据保留', () => {
      const v3 = {
        format: 'nodeflow',
        version: 3,
        document: {
          name: 'P',
          color: '#fff',
          graph: { nodes: [{ id: 'A' }], edges: [], annotations: [], stages: [] },
          editor: { viewport: { x: 1, y: 2, zoom: 0.5 }, activeTabId: 'main', compositeTabs: [] },
        },
      };
      const doc = migrateProjectV3ToDocument(v3);
      expect(doc.nodes.map((n) => n.id)).toEqual(['A']);
      expect(doc.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
      expect(doc.activeTabId).toBe('main');
    });

    it('migrateProjectV3ToDocument:deterministic 且不修改输入', () => {
      const input = { format: 'nodeflow', version: 3, document: { graph: { nodes: [], edges: [] }, editor: {} } };
      const a = migrateProjectV3ToDocument(input);
      const b = migrateProjectV3ToDocument(input);
      expect(a).toEqual(b);
      expect(input).toEqual({ format: 'nodeflow', version: 3, document: { graph: { nodes: [], edges: [] }, editor: {} } });
    });

    it('future version rejection:v5+ 被拒绝', () => {
      const info = detectDocumentFormat({ format: 'nodeflow', version: CURRENT_PROJECT_VERSION + 1, document: {} });
      expect(info.future).toBe(true);
      expect(futureVersionMessage(info)).toContain('升级 NodeFlow');
    });
  });
});
