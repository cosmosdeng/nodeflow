import { useEffect, useState } from 'react';
import Toolbar from './components/Toolbar';
import FlowCanvas from './components/FlowCanvas';
import OutlinePanel from './components/OutlinePanel';
import PropertiesPanel from './components/PropertiesPanel';
import HistoryPanel from './components/HistoryPanel';
import ParticipantsPanel from './components/ParticipantsPanel';
import CompositePopupView from './components/CompositePopupView';
import { openCompositePopup } from './lib/compositePopup';
import { useGraphStore } from './store/graphStore';
import { confirmAndCloseDocument } from './lib/closeProject';

function MainApp() {
  const [showOutline, setShowOutline] = useState(false);
  // [product] 启动默认不打开属性面板,需要时点工具栏「⚙ 属性」打开
  const [showProperties, setShowProperties] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const saveNow = useGraphStore((s) => s.saveNow);
  const saveDocument = useGraphStore((s) => s.saveDocument);
  const allLocked = useGraphStore((s) => s.allLocked);
  const nodesCount = useGraphStore((s) => s.nodes.length);
  const edgesCount = useGraphStore((s) => s.edges.length);
  const zoom = useGraphStore((s) => s.viewport.zoom);
  const theme = useGraphStore((s) => s.theme);
  const nodes = useGraphStore((s) => s.nodes);
  const compositeTabs = useGraphStore((s) => s.compositeTabs);
  const activeTabId = useGraphStore((s) => s.activeTabId);
  const setActiveTab = useGraphStore((s) => s.setActiveTab);
  const closeCompositeTab = useGraphStore((s) => s.closeCompositeTab);
  const documents = useGraphStore((s) => s.documents);
  const activeDocumentId = useGraphStore((s) => s.activeDocumentId);
  const switchDocument = useGraphStore((s) => s.switchDocument);
  const closeDocument = useGraphStore((s) => s.closeDocument);
  const createDocument = useGraphStore((s) => s.createDocument);
  const loadProject = useGraphStore((s) => s.loadProject);
  const copySelection = useGraphStore((s) => s.copySelection);
  const pasteClipboard = useGraphStore((s) => s.pasteClipboard);

  // 应用全局配色主题到根元素
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 桌面端:双击 .nodeflow 文件 → 自动打开项目(主进程通过 IPC 推送文件内容)
  useEffect(() => {
    const nf = window.nodeflow;
    if (!nf?.onOpenProjectFile) return;
    const off = nf.onOpenProjectFile(({ content }) => {
      const ok = loadProject(content);
      if (ok) {
        // 项目作为新文档打开后,适配到全图
        setTimeout(() => {
          useGraphStore.getState().fitGraph?.();
        }, 120);
      } else {
        alert(useGraphStore.getState().loadError ?? '无法打开该项目文件,请确认是 NodeFlow 保存的项目。');
      }
    });
    return off;
  }, [loadProject]);

  // 全局快捷键:撤销 / 重做 / 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 正在编辑文本时,快捷键留给输入框本身,不触发全局操作
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        saveNow();
        return;
      }
      // 演示锁定时禁止撤销/重做/复制/粘贴,避免误触修改内容
      if (allLocked) return;
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === 'c') {
        // 复制选中节点/组合到剪贴板(跨画布/跨项目共享)
        e.preventDefault();
        const n = copySelection();
        if (n === 0) alert('未选中任何节点,无法复制。请先点击选中一个或多个节点。');
      } else if (key === 'v') {
        // 粘贴到当前画布
        e.preventDefault();
        const n = pasteClipboard();
        if (n === 0 && !useGraphStore.getState().clipboard) {
          alert('剪贴板为空,请先选中节点后按 ⌘/Ctrl+C 复制。');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allLocked, undo, redo, saveNow, copySelection, pasteClipboard]);

  return (
    <div className="app">
      <Toolbar
        showOutline={showOutline}
        showProperties={showProperties}
        showHistory={showHistory}
        showParticipants={showParticipants}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleProperties={() => setShowProperties((v) => !v)}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onToggleParticipants={() => setShowParticipants((v) => !v)}
      />

      {/* 标签栏:项目文档标签 + 当前项目内(主画布 + 组合内部画布)标签 */}
      <div className="tab-bar">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={`tab doc ${activeDocumentId === doc.id ? 'active' : ''}`}
            onClick={() => switchDocument(doc.id)}
            title={`项目:${doc.name}`}
          >
            <span className="doc-dot" style={{ background: doc.color }} />
            <span className="tab-label">{doc.name}</span>
            <button
              className="tab-btn"
              title="关闭该项目"
              onClick={(e) => {
                e.stopPropagation();
                confirmAndCloseDocument(doc, closeDocument, saveDocument);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="tab-btn add-doc" title="新建项目" onClick={() => createDocument()}>
          ＋
        </button>

        <span className="tab-sep" />

        {/* 当前项目内:主画布 + 各组合节点的内部画布(相邻) */}
        <div
          className={`tab ${activeTabId === 'main' ? 'active' : ''}`}
          onClick={() => setActiveTab('main')}
          title="主画布"
        >
          🏠 主画布
        </div>
        {compositeTabs.map((cid) => {
          const comp = nodes.find((n) => n.id === cid);
          return (
            <div
              key={cid}
              className={`tab ${activeTabId === cid ? 'active' : ''}`}
              onClick={() => setActiveTab(cid)}
              title={comp?.data.label ?? cid}
            >
              <span className="tab-icon">⧉</span>
              <span className="tab-label">{comp?.data.label ?? cid}</span>
              <button
                className="tab-btn"
                title="在新窗口弹出内部画布"
                onClick={(e) => {
                  e.stopPropagation();
                  openCompositePopup(cid);
                }}
              >
                ⇱
              </button>
              <button
                className="tab-btn"
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation();
                  closeCompositeTab(cid);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="app-main">
        {showOutline && <OutlinePanel onClose={() => setShowOutline(false)} />}
        {showParticipants && <ParticipantsPanel onClose={() => setShowParticipants(false)} />}
        <FlowCanvas />
        {showProperties && <PropertiesPanel onClose={() => setShowProperties(false)} />}
        {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      </div>

      <div className="statusbar">
        {allLocked ? (
          <span className="stat" style={{ color: '#ffc53d', fontWeight: 600 }}>
            🔒 演示模式已锁定全部内容
          </span>
        ) : (
          <span className="stat">⬤ {nodesCount} 节点</span>
        )}
        {!allLocked && <span className="stat">— {edgesCount} 连线</span>}
        {activeTabId !== 'main' && (
          <span className="stat" style={{ color: 'var(--accent)' }}>
            ⧉ 内部画布视图
          </span>
        )}
        <span className="stat">🔍 {Math.round(zoom * 100)}%</span>
        <span className="stat" style={{ marginLeft: 'auto' }}>
          {allLocked
            ? '仅可查看,点击工具栏「解锁全部」恢复编辑'
            : '双击画布空白添加节点 · 拖拽节点移动 · 从端口拖出连线 · Delete 删除'}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  // 独立窗口模式:?composite=<id> 展示组合节点的内部画布
  const params = new URLSearchParams(window.location.search);
  const popupId = params.get('composite');
  if (popupId) {
    return <CompositePopupView id={popupId} />;
  }
  return <MainApp />;
}
