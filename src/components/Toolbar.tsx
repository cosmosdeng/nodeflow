import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import {
  EDGE_STYLE_LABELS,
  THEME_LABELS,
  type EdgeStyle,
  type GraphSnapshot,
  type ThemeMode,
} from '../types';
import {
  PAPER_SIZES,
  exportCanvasImage,
  type ExportImageFormat,
  type PaperSize,
} from '../lib/exportImage';
import { buildSvg, downloadSvg } from '../lib/exportSvg';
import { confirmAndCloseDocument } from '../lib/closeProject';

interface Props {
  showOutline: boolean;
  showProperties: boolean;
  showHistory: boolean;
  showParticipants: boolean;
  onToggleOutline: () => void;
  onToggleProperties: () => void;
  onToggleHistory: () => void;
  onToggleParticipants: () => void;
}

export default function Toolbar({
  showOutline,
  showProperties,
  showHistory,
  showParticipants,
  onToggleOutline,
  onToggleProperties,
  onToggleHistory,
  onToggleParticipants,
}: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // 导出幅面:默认「完整画布」
  const [exportPaper, setExportPaper] = useState<PaperSize>(PAPER_SIZES[0]);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pastLen = useGraphStore((s) => s.past.length);
  const futureLen = useGraphStore((s) => s.future.length);
  const dirty = useGraphStore((s) => s.dirty);
  const lastSavedAt = useGraphStore((s) => s.lastSavedAt);
  const edgeStyle = useGraphStore((s) => s.edgeStyle);
  const setEdgeStyle = useGraphStore((s) => s.setEdgeStyle);
  const theme = useGraphStore((s) => s.theme);
  const setTheme = useGraphStore((s) => s.setTheme);

  const cycleEdgeStyle = () => {
    const next: EdgeStyle = edgeStyle === 'smoothstep' ? 'bezier' : 'smoothstep';
    setEdgeStyle(next);
  };

  const cycleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const addNode = useGraphStore((s) => s.addNode);
  const nodes = useGraphStore((s) => s.nodes);
  const toggleAllAnnotations = useGraphStore((s) => s.toggleAllAnnotations);
  const annotations = useGraphStore((s) => s.annotations);
  const edges = useGraphStore((s) => s.edges);
  const groupSelected = useGraphStore((s) => s.groupSelected);
  const allLocked = useGraphStore((s) => s.allLocked);
  const toggleLockAll = useGraphStore((s) => s.toggleLockAll);
  const setSelected = useGraphStore((s) => s.setSelected);
  const requestAutoEdit = useGraphStore((s) => s.requestAutoEdit);
  const autoLayout = useGraphStore((s) => s.autoLayout);
  const addStage = useGraphStore((s) => s.addStage);
  const selectStage = useGraphStore((s) => s.selectStage);
  const createDocument = useGraphStore((s) => s.createDocument);
  const clearGraph = useGraphStore((s) => s.clearGraph);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const exportJson = useGraphStore((s) => s.exportJson);
  const serializeProject = useGraphStore((s) => s.serializeProject);
  const loadProject = useGraphStore((s) => s.loadProject);
  const closeDocument = useGraphStore((s) => s.closeDocument);
  const saveDocument = useGraphStore((s) => s.saveDocument);
  const swimlaneEnabled = useGraphStore((s) => s.swimlaneEnabled);
  const toggleSwimlane = useGraphStore((s) => s.toggleSwimlane);
  const arrangeAllSwimlanes = useGraphStore((s) => s.arrangeAllSwimlanes);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow();

  const handleAddNode = () => {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = addNode(undefined, { x: pos.x - 115, y: pos.y - 60 });
    setSelected({ kind: 'node', id });
    requestAutoEdit({ kind: 'node-title', id });
  };

  const handleAddStage = () => {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = addStage(pos.x - 250, pos.y - 150, 500, 300);
    if (id) {
      selectStage(id);
      // 新建阶段域后自动进入名称编辑态(域框左上角名称框)
      requestAutoEdit({ kind: 'stage-name', id });
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nodeflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const snap: GraphSnapshot = {
          nodes: data.nodes ?? data.graph?.nodes ?? [],
          edges: data.edges ?? data.graph?.edges ?? [],
          viewport: data.viewport ?? { x: 0, y: 0, zoom: 1 },
        };
        if (!Array.isArray(snap.nodes) || !Array.isArray(snap.edges)) {
          throw new Error('bad file');
        }
        loadGraph(snap);
        // 文件缺少视口信息时,自动适配到可见范围
        setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      } catch {
        alert('无法解析该文件,请确认是 NodeFlow 导出的 JSON。');
      }
    };
    reader.readAsText(file);
  };

  /** 保存项目:把当前编辑状态(含撤销历史)下载为项目文件 */
  const handleSaveProject = () => {
    const json = serializeProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.nodeflow`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 打开项目:从项目文件恢复完整编辑状态与历史 */
  const handleOpenProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = loadProject(String(reader.result));
      if (ok) {
        setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
      } else {
        alert(useGraphStore.getState().loadError ?? '无法解析项目文件,请确认是 NodeFlow 保存的项目文件。');
      }
    };
    reader.readAsText(file);
  };

  /** 导出图片(完整画布,支持幅面) */
  const handleExportImage = async (format: ExportImageFormat) => {
    try {
      // 计算所有可见节点的内容包围盒(流坐标)
      const visible = nodes.filter((n) => !n.hidden);
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const n of visible) {
        const w = n.measured?.width ?? 230;
        const h = n.measured?.height ?? 120;
        left = Math.min(left, n.position.x);
        top = Math.min(top, n.position.y);
        right = Math.max(right, n.position.x + w);
        bottom = Math.max(bottom, n.position.y + h);
      }
      if (visible.length === 0) {
        left = 0;
        top = 0;
        right = 400;
        bottom = 200;
      }
      const bounds = { left, top, width: right - left, height: bottom - top };
      if (format === 'svg') {
        // SVG 用数据驱动矢量重绘,保证真正矢量且连线正常
        const { svg } = buildSvg(nodes, edges, theme, exportPaper, bounds);
        const baseName = `nodeflow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
        downloadSvg(svg, `${baseName}.svg`);
      } else {
        await exportCanvasImage(
          { getViewport, setViewport, fitView },
          format,
          exportPaper,
          bounds,
        );
      }
    } catch (e) {
      console.error(e);
      alert(`导出 ${format.toUpperCase()} 失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const projectName =
    useGraphStore((s) => s.documents.find((d) => d.id === s.activeDocumentId)?.name) ?? '未命名项目';

  const saveTime = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : '';

  return (
    <header className="toolbar">
      <span className="brand">NodeFlow</span>

      <div style={{ position: 'relative' }}>
        <button className="tb-btn" onClick={() => setFileOpen((v) => !v)}>
          📂 文件
        </button>
        {fileOpen && (
          <div className="file-actions" onMouseLeave={() => setFileOpen(false)}>
            <button
              disabled={allLocked}
              onClick={() => {
                if (confirm('新建一个空项目?当前项目保持不变,可通过标签切换。')) {
                  createDocument();
                  setFileOpen(false);
                }
              }}
            >
              🆕 新建项目
            </button>
            <button
              disabled={allLocked}
              onClick={() => {
                projectFileRef.current?.click();
                setFileOpen(false);
              }}
            >
              📂 打开项目…
            </button>
            <button onClick={() => { handleSaveProject(); setFileOpen(false); }}>
              💾 保存项目
            </button>
            <button
              onClick={() => {
                confirmAndCloseDocument(
                  { id: useGraphStore.getState().activeDocumentId, name: projectName, dirty },
                  closeDocument,
                  saveDocument,
                );
                setFileOpen(false);
              }}
            >
              📕 关闭项目
            </button>

            <div className="file-submenu">
              <button
                onClick={() => {
                  setImportOpen((v) => !v);
                  setExportOpen(false);
                }}
              >
                📥 导入
                <span className="submenu-arrow">▸</span>
              </button>
              {importOpen && (
                <div className="file-submenu-panel">
                  <button
                    onClick={() => {
                      fileRef.current?.click();
                      setFileOpen(false);
                    }}
                  >
                    📄 导入 JSON…
                  </button>
                </div>
              )}
            </div>

            <div className="file-submenu">
              <button
                onClick={() => {
                  setExportOpen((v) => !v);
                  setImportOpen(false);
                }}
              >
                📤 导出
                <span className="submenu-arrow">▸</span>
              </button>
              {exportOpen && (
                <div className="file-submenu-panel export-panel">
                  <button onClick={() => { handleExport(); setFileOpen(false); }}>
                    📄 导出 JSON…
                  </button>
                  <div className="submenu-divider" />
                  {/* 幅面选择 */}
                  {PAPER_SIZES.map((p) => (
                    <button
                      key={p.key}
                      className={exportPaper.key === p.key ? 'active' : ''}
                      onClick={() => setExportPaper(p)}
                    >
                      <span className={`radio-dot ${exportPaper.key === p.key ? 'on' : ''}`} />
                      幅面:{p.label}
                    </button>
                  ))}
                  <div className="submenu-divider" />
                  <button disabled={allLocked} onClick={() => { handleExportImage('jpeg'); setFileOpen(false); }}>
                    🖼 导出 JPG…
                  </button>
                  <button disabled={allLocked} onClick={() => { handleExportImage('pdf'); setFileOpen(false); }}>
                    📑 导出 PDF…
                  </button>
                  {/* SVG 导出暂不可用(数据驱动重绘尚未完善),先置灰;将来恢复时去掉 disabled 即可 */}
                  <button
                    disabled
                    title="SVG 导出暂不可用,后续版本开放"
                    onClick={() => { handleExportImage('svg'); setFileOpen(false); }}
                  >
                    📐 导出 SVG…
                  </button>
                </div>
              )}
            </div>

            <button
              disabled={allLocked}
              onClick={() => {
                if (confirm('清空画布上的所有节点与连线?')) clearGraph();
                setFileOpen(false);
              }}
            >
              🧹 清空画布
            </button>
          </div>
        )}
        {/* 打开项目(完整编辑状态) */}
        <input
          ref={projectFileRef}
          type="file"
          accept=".nodeflow,application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleOpenProject(f);
            e.target.value = '';
          }}
        />
        {/* 导入 JSON(静态画布) */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = '';
          }}
        />
      </div>

      <span className="sep" />

      <button className="tb-btn" title="撤销 (Ctrl+Z)" disabled={allLocked || pastLen === 0} onClick={undo}>
        ↩ 撤销
      </button>
      <button
        className="tb-btn"
        title="重做 (Ctrl+Shift+Z)"
        disabled={allLocked || futureLen === 0}
        onClick={redo}
      >
        ↪ 重做
      </button>

      <span className="sep" />

      <button className="tb-btn primary" disabled={allLocked} onClick={handleAddNode}>
        ＋ 添加节点
      </button>
      <button
        className="tb-btn"
        disabled={allLocked}
        title="添加流程阶段域(矩形虚线框,把节点完全拖入即归属)"
        onClick={handleAddStage}
      >
        ▦ 添加阶段域
      </button>
      <button
        className="tb-btn"
        disabled={
          allLocked || nodes.filter((n) => n.selected).length < 2
        }
        title="将选中的 2 个以上节点组合为一个组合节点,支持把已有组合节点编入新组合"
        onClick={() => {
          const id = groupSelected();
          if (id) setSelected({ kind: 'node', id });
        }}
      >
        ⧉ 组合节点
      </button>

      <button
        className="tb-btn"
        disabled={allLocked || annotations.length === 0}
        title="一键展开 / 收起所有注释"
        onClick={() => toggleAllAnnotations()}
      >
        💬 注释
      </button>

      <span className="sep" />

      <button
        className="tb-btn"
        disabled={allLocked}
        title="按连线依赖关系自动横向排列;选中组合节点时对其内部节点排列,否则排列全画布"
        onClick={() => {
          const selComp = nodes.find((n) => n.selected && n.data.composite);
          autoLayout('horizontal', selComp ? { compositeId: selComp.id } : undefined);
        }}
      >
        ⤺ 自动排列
      </button>

      <span className="sep" />

      <button
        className={`tb-btn ${allLocked ? 'active' : ''}`}
        style={
          allLocked
            ? { borderColor: 'rgba(232,176,40,.6)', color: '#ffc53d', fontWeight: 600 }
            : undefined
        }
        title={allLocked ? '演示模式已锁定,点击解锁全部内容' : '演示模式:一键锁定所有节点与连线,防止误编辑'}
        onClick={toggleLockAll}
      >
        {allLocked ? '🔒 锁定全部' : '🔓 锁定全部'}
      </button>

      <span className="sep" />

      <button className={`tb-btn ${showOutline ? 'active' : ''}`} onClick={onToggleOutline}>
        🗂 大纲
      </button>
      <button className={`tb-btn ${showProperties ? 'active' : ''}`} onClick={onToggleProperties}>
        ⚙ 属性
      </button>
      <button className={`tb-btn ${showHistory ? 'active' : ''}`} onClick={onToggleHistory}>
        🕘 历史
      </button>
      <button className={`tb-btn ${showParticipants ? 'active' : ''}`} onClick={onToggleParticipants}>
        👤 参与方
      </button>
      <button
        className={`tb-btn ${swimlaneEnabled ? 'active' : ''}`}
        onClick={toggleSwimlane}
        title="泳道显示开关(不改变节点位置/参与方)"
      >
        🏊 泳道
      </button>
      <button className="tb-btn" onClick={arrangeAllSwimlanes} title="把节点按参与方整理到泳道(只改位置,不改参与方)">
        ⇣ 整理泳道
      </button>

      <span className="sep" />

      <button
        className="tb-btn"
        title="切换连线风格(直角/弧线)"
        onClick={cycleEdgeStyle}
      >
        {edgeStyle === 'bezier' ? '〰' : '⤢'} {EDGE_STYLE_LABELS[edgeStyle]}
      </button>
      <button className="tb-btn" title="切换画布配色" onClick={cycleTheme}>
        {theme === 'dark' ? '🌙' : '☀️'} {THEME_LABELS[theme]}
      </button>

      <div className="toolbar-right">
        <span className="save-state" title="自动保存状态">
          {dirty ? (
            <>
              <span className="dot saving" /> 保存中…
            </>
          ) : (
            <>
              <span className="dot" /> {saveTime ? `已自动保存 ${saveTime}` : '自动保存已开启'}
            </>
          )}
        </span>
      </div>
    </header>
  );
}
