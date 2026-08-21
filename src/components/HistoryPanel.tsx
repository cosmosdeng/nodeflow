import { useGraphStore } from '../store/graphStore';

interface Props {
  onClose: () => void;
}

function fmtTime(at?: number) {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}

export default function HistoryPanel({ onClose }: Props) {
  const past = useGraphStore((s) => s.past);
  const future = useGraphStore((s) => s.future);
  const allLocked = useGraphStore((s) => s.allLocked);
  const jumpTo = useGraphStore((s) => s.jumpTo);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);

  const currentNodes = useGraphStore((s) => s.nodes.length);
  const currentEdges = useGraphStore((s) => s.edges.length);

  return (
    <aside className="panel right" style={{ width: 260 }}>
      <div className="panel-header">
        <span>历史记录 · {past.length} 步</span>
        <button className="panel-close" onClick={onClose} title="关闭历史面板">
          ×
        </button>
      </div>
      <div className="panel-body">
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 12,
          }}
        >
          <button className="tb-btn" style={{ flex: 1, justifyContent: 'center' }} disabled={allLocked || past.length === 0} onClick={undo}>
            ↩ 撤销
          </button>
          <button className="tb-btn" style={{ flex: 1, justifyContent: 'center' }} disabled={allLocked || future.length === 0} onClick={redo}>
            ↪ 重做
          </button>
        </div>

        <div className="history-list">
          {future.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  margin: '4px 2px',
                }}
              >
                未来 (可重做)
              </div>
              {future
                .slice()
                .reverse()
                .map((f, i) => (
                  <div key={`f${i}`} className="history-item" style={{ opacity: 0.55 }}>
                    <div className="h-time">{fmtTime(f.at)}</div>
                    <div>
                      {f.nodes.length} 节点 · {f.edges.length} 连线
                    </div>
                  </div>
                ))}
            </>
          )}

          <div
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              fontWeight: 600,
              margin: '4px 2px',
            }}
          >
            当前状态
          </div>
          <div
            className="history-item"
            style={{ borderColor: 'rgba(78,161,255,.5)', background: 'var(--accent-soft)' }}
          >
            <div className="h-time">现在</div>
            <div>
              {currentNodes} 节点 · {currentEdges} 连线
            </div>
          </div>

          {past.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  margin: '4px 2px',
                }}
              >
                过去 (点击回溯)
              </div>
              {past
                .slice()
                .reverse()
                .map((p, i) => {
                  const idx = past.length - 1 - i;
                  return (
                    <div
                      key={`p${idx}`}
                      className={`history-item ${allLocked ? 'disabled' : ''}`}
                      onClick={() => {
                        if (allLocked) return;
                        jumpTo(idx);
                      }}
                    >
                      <div className="h-time">{fmtTime(p.at)}</div>
                      <div>
                        {p.nodes.length} 节点 · {p.edges.length} 连线
                      </div>
                    </div>
                  );
                })}
            </>
          )}

          {past.length === 0 && future.length === 0 && (
            <div className="empty-tip">
              <div className="big">🕘</div>
              还没有历史记录。
              <br />
              对画布做出修改后,可在此回溯任意步骤。
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
