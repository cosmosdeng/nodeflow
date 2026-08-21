import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import type { GraphSnapshot } from '../types';

interface Props {
  showOutline: boolean;
  showProperties: boolean;
  showHistory: boolean;
  onToggleOutline: () => void;
  onToggleProperties: () => void;
  onToggleHistory: () => void;
}

export default function Toolbar({
  showOutline,
  showProperties,
  showHistory,
  onToggleOutline,
  onToggleProperties,
  onToggleHistory,
}: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pastLen = useGraphStore((s) => s.past.length);
  const futureLen = useGraphStore((s) => s.future.length);
  const dirty = useGraphStore((s) => s.dirty);
  const lastSavedAt = useGraphStore((s) => s.lastSavedAt);

  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const addNode = useGraphStore((s) => s.addNode);
  const setSelected = useGraphStore((s) => s.setSelected);
  const newDocument = useGraphStore((s) => s.newDocument);
  const clearGraph = useGraphStore((s) => s.clearGraph);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const exportJson = useGraphStore((s) => s.exportJson);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const handleAddNode = () => {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = addNode(undefined, { x: pos.x - 115, y: pos.y - 60 });
    setSelected({ kind: 'node', id });
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
              onClick={() => {
                if (confirm('新建文档将清空当前画布,历史记录仍可撤销。继续?')) {
                  newDocument();
                  setFileOpen(false);
                }
              }}
            >
              🆕 新建文档
            </button>
            <button
              onClick={() => {
                fileRef.current?.click();
                setFileOpen(false);
              }}
            >
              📥 打开 JSON…
            </button>
            <button onClick={() => { handleExport(); setFileOpen(false); }}>
              📤 导出 JSON…
            </button>
            <button
              onClick={() => {
                if (confirm('清空画布上的所有节点与连线?')) clearGraph();
                setFileOpen(false);
              }}
            >
              🧹 清空画布
            </button>
          </div>
        )}
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

      <button className="tb-btn" title="撤销 (Ctrl+Z)" disabled={pastLen === 0} onClick={undo}>
        ↩ 撤销
      </button>
      <button
        className="tb-btn"
        title="重做 (Ctrl+Shift+Z)"
        disabled={futureLen === 0}
        onClick={redo}
      >
        ↪ 重做
      </button>

      <span className="sep" />

      <button className="tb-btn primary" onClick={handleAddNode}>
        ＋ 添加节点
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
