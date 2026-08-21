import { useEffect, useState } from 'react';
import Toolbar from './components/Toolbar';
import FlowCanvas from './components/FlowCanvas';
import OutlinePanel from './components/OutlinePanel';
import PropertiesPanel from './components/PropertiesPanel';
import HistoryPanel from './components/HistoryPanel';
import { useGraphStore } from './store/graphStore';

export default function App() {
  const [showOutline, setShowOutline] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const saveNow = useGraphStore((s) => s.saveNow);
  const nodesCount = useGraphStore((s) => s.nodes.length);
  const edgesCount = useGraphStore((s) => s.edges.length);
  const zoom = useGraphStore((s) => s.viewport.zoom);
  const theme = useGraphStore((s) => s.theme);

  // 应用全局配色主题到根元素
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 全局快捷键:撤销 / 重做 / 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === 's') {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveNow]);

  return (
    <div className="app">
      <Toolbar
        showOutline={showOutline}
        showProperties={showProperties}
        showHistory={showHistory}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleProperties={() => setShowProperties((v) => !v)}
        onToggleHistory={() => setShowHistory((v) => !v)}
      />

      <div className="app-main">
        {showOutline && <OutlinePanel onClose={() => setShowOutline(false)} />}
        <FlowCanvas />
        {showProperties && <PropertiesPanel onClose={() => setShowProperties(false)} />}
        {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      </div>

      <div className="statusbar">
        <span className="stat">⬤ {nodesCount} 节点</span>
        <span className="stat">— {edgesCount} 连线</span>
        <span className="stat">🔍 {Math.round(zoom * 100)}%</span>
        <span className="stat" style={{ marginLeft: 'auto' }}>
          双击画布空白添加节点 · 拖拽节点移动 · 从端口拖出连线 · Delete 删除
        </span>
      </div>
    </div>
  );
}
