/**
 * Matrix label 命中表(纯 UI,不入 store/不持久化):
 * MatrixVisualLayer 每帧把屏幕矩形写入,FlowCanvas/编辑监听用 clientX/Y 命中。
 * 用途:即使 label 被个别浮层覆盖或 React Flow 吞事件,仍能坐标级识别 label 区域,
 * 从而避免「双击 label 误建节点」并可靠进入名称编辑。
 */
export interface MatrixLabelHit {
  kind: 'stage' | 'lane';
  id: string;
  key: string;
  text: string;
  /** 屏幕坐标矩形(相对画布容器左上) */
  l: number;
  t: number;
  r: number;
  b: number;
}

const hits: MatrixLabelHit[] = [];

export function setMatrixLabelHits(next: MatrixLabelHit[]): void {
  hits.length = 0;
  for (const h of next) hits.push(h);
}

export function findMatrixLabelHit(clientX: number, clientY: number): MatrixLabelHit | undefined {
  return hits.find((h) => clientX >= h.l && clientX <= h.r && clientY >= h.t && clientY <= h.b);
}
