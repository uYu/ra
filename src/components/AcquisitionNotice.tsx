import type { Move } from "../game/presentation.ts";
import { tileLabel } from "../game/data.ts";
import { TileArt } from "./TileArt.tsx";
export function AcquisitionNotice({
  move,
  name,
  onDetails,
  onBoard,
  onDismiss,
}: {
  move: Move;
  name: string;
  onDetails: () => void;
  onBoard: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="acquisition-notice" aria-label="新收获提醒">
      <div className="acquisition-copy" role="status">
        <b>
          {name}最近获得 {move.tiles.length} 块牌
        </b>
        <span>当前玩家板保持不变</span>
      </div>
      <div className="acquisition-icons" aria-hidden="true">
        {move.tiles.slice(0, 4).map((t) => (
          <span key={t.id} title={tileLabel(t)}>
            <TileArt kind={t.kind} variant={t.variant} />
          </span>
        ))}
        {move.tiles.length > 4 && <small>+{move.tiles.length - 4}</small>}
      </div>
      <div className="acquisition-actions">
        <button onClick={onDetails}>查看收获</button>
        <button onClick={onBoard}>查看棋盘</button>
        <button
          className="dismiss-acquisition"
          onClick={onDismiss}
          aria-label="关闭收获提醒"
        >
          ×
        </button>
      </div>
    </section>
  );
}
