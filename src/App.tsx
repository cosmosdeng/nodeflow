import { useEffect, useRef, useState } from 'react';
import Toolbar from './components/Toolbar';
import FlowCanvas from './components/FlowCanvas';
import OutlinePanel from './components/OutlinePanel';
import PropertiesPanel from './components/PropertiesPanel';
import HistoryPanel from './components/HistoryPanel';
import SemanticPanel from './components/SemanticPanel';
import CompositePopupView from './components/CompositePopupView';
import DialogHost from './components/DialogHost';
import { openCompositePopup } from './lib/compositePopup';
import { useGraphStore } from './store/graphStore';
import { confirmAndCloseDocument } from './lib/closeProject';
import { alertDialogAsync } from './lib/dialog';

function MainApp() {
  const [showOutline, setShowOutline] = useState(false);
  // [product] 启动默认不打开属性面板,需要时点工具栏「⚙ 属性」打开
  const [showProperties, setShowProperties] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSemantic, setShowSemantic] = useState(false);

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
        void alertDialogAsync(
          useGraphStore.getState().loadError ?? '无法打开该项目文件,请确认是 NodeFlow 保存的项目。',
        );
      }
    });
    return off;
  }, [loadProject]);

  // 全局快捷键:撤销 / 重做 / 保存 / 键盘移动 / 键盘连线
  const linkSourceRef = useRef<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 正在编辑文本时,快捷键留给输入框本身,不触发全局操作
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // ---- 非修饰键:键盘移动 / 连线 / 取消 ----
      if (!mod) {
        // 方向键移动选中节点(Shift = 大步进)
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          const st = useGraphStore.getState();
          if (st.allLocked) return;
          if (!st.nodes.some((n) => n.selected)) return;
          e.preventDefault();
          const step = e.shiftKey ? 50 : 10;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          // 走 store action:纳入历史栈,连续按键在 500ms 窗口内合并为一次撤销
          st.nudgeSelectedNodes(dx, dy);
          return;
        }
        // L:键盘连线 — 第一次按下记录源节点,第二次按下连线到当前选中节点
        if (key === 'l') {
          const st = useGraphStore.getState();
          if (st.allLocked) return;
          const sel = st.selected;
          if (!sel || sel.kind !== 'node') {
            void alertDialogAsync('请先选中一个节点作为连线起点/终点,再按 L。');
            return;
          }
          if (linkSourceRef.current === null) {
            linkSourceRef.current = sel.id;
            const srcNode = st.nodes.find((n) => n.id === sel.id);
            setLinkHint(`连线起点:「${srcNode?.data.label ?? sel.id}」— 选中目标节点后按 L 完成,Esc 取消`);
          } else {
            const srcId = linkSourceRef.current;
            linkSourceRef.current = null;
            setLinkHint(null);
            if (srcId === sel.id) return; // 自连忽略
            // 源节点输出端口 → 目标节点输入端口
            const srcNode = st.nodes.find((n) => n.id === srcId);
            const outPort = srcNode?.data.outputs?.[0]?.id;
            const inPort = st.nodes.find((n) => n.id === sel.id)?.data.inputs?.[0]?.id;
            st.onConnect({
              source: srcId,
              sourceHandle: outPort ?? null,
              target: sel.id,
              targetHandle: inPort ?? null,
            });
          }
          return;
        }
        // Esc:取消连线模式
        if (e.key === 'Escape' && linkSourceRef.current !== null) {
          linkSourceRef.current = null;
          setLinkHint(null);
          return;
        }
        return;
      }

      // ---- 修饰键组合 ----
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
        if (n === 0) void alertDialogAsync('未选中任何节点,无法复制。请先点击选中一个或多个节点。');
      } else if (key === 'v') {
        // 粘贴到当前画布
        e.preventDefault();
        const n = pasteClipboard();
        if (n === 0 && !useGraphStore.getState().clipboard) {
          void alertDialogAsync('剪贴板为空,请先选中节点后按 ⌘/Ctrl+C 复制。');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allLocked, undo, redo, saveNow, copySelection, pasteClipboard]);

  const setSemanticFocus = useGraphStore((s) => s.setSemanticFocus);

  /** 属性栏「管理…」 → 打开语义面板并聚焦当前选中节点的参与方 / 阶段(双向联动) */
  const openSemantic = (kind: 'participant' | 'stage') => {
    const st = useGraphStore.getState();
    let id: string | null = null;
    const sel = st.selected;
    if (sel?.kind === 'node') {
      const node = st.nodes.find((n) => n.id === sel.id);
      if (node) {
        id =
          kind === 'participant'
            ? (node.data.participantId ?? null)
            : (st.stages.find((s) => s.nodeIds.includes(node.id))?.id ?? null);
      }
    }
    setSemanticFocus({ kind, id });
    setShowSemantic(true);
  };

  return (
    <div className="app">
      <Toolbar
        showOutline={showOutline}
        showProperties={showProperties}
        showHistory={showHistory}
        showSemantic={showSemantic}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleProperties={() => setShowProperties((v) => !v)}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onToggleSemantic={() => setShowSemantic((v) => !v)}
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
        {showSemantic && <SemanticPanel onClose={() => setShowSemantic(false)} />}
        <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
          <FlowCanvas />
          {linkHint && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
                padding: '8px 16px',
                borderRadius: 8,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
                color: 'var(--text)',
                fontSize: 12,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              🔗 {linkHint}
            </div>
          )}
        </div>
        {showProperties && <PropertiesPanel onClose={() => setShowProperties(false)} onOpenSemantic={openSemantic} />}
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

      <DialogHost />
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
