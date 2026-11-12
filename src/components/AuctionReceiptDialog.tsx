import { ArrowRight, Eye, Trophy } from "lucide-react";
import type { AuctionReceipt } from "../game/presentation.ts";
import type { State } from "../game/types.ts";
import { isDisaster, tileName } from "../game/data.ts";
import { Dialog } from "./Dialog.tsx";
import { SunDiskArt } from "./TokenIllustration.tsx";
import { TileArt } from "./TileArt.tsx";
import "./AuctionReceiptDialog.css";

export function AuctionReceiptDialog({
  receipt,
  state,
  onContinue,
  onViewWinner,
}: {
  receipt: AuctionReceipt;
  state: State;
  onContinue: () => void;
  onViewWinner: () => void;
}) {
  const winner = state.players[receipt.winner].name;
  const next =
    state.phase === "epoch" || state.phase === "over"
      ? "本纪元结束，接下来查看结算。"
      : state.phase === "disaster"
        ? `接下来由${state.players[state.current].name}处理灾难。`
        : `接下来轮到${state.players[state.current].name}行动。`;
  return (
    <Dialog title="拍卖成交" onClose={onContinue} className="auction-receipt">
      <div className="receipt-winner">
        <Trophy aria-hidden="true" />
        <div>
          <span>本轮赢家</span>
          <strong>{winner}</strong>
          <p>
            {receipt.paid} 号太阳成交 · 拍下 {receipt.tiles.length} 块拍品
          </p>
        </div>
      </div>
      <div className="receipt-exchange">
        <div>
          <span className="receipt-sun">
            <SunDiskArt />
            <b>{receipt.paid}</b>
          </span>
          <span>
            付出太阳<strong>{receipt.paid} 号 · 成为中央太阳</strong>
          </span>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span className="receipt-sun is-used">
            <SunDiskArt />
            <b>{receipt.received}</b>
          </span>
          <span>
            换回太阳<strong>{receipt.received} 号 · 本纪元已使用</strong>
          </span>
        </div>
      </div>
      <section
        className="receipt-lot"
        tabIndex={0}
        aria-label="本次拍下的全部拍品"
      >
        <h3>
          拍品归属 <b>{winner}</b>
          <span>{receipt.tiles.length} 块</span>
        </h3>
        {receipt.tiles.length ? (
          <ul>
            {receipt.tiles.map((tile) => (
              <li
                key={tile.id}
                className={isDisaster(tile.kind) ? "is-disaster" : ""}
              >
                <TileArt kind={tile.kind} variant={tile.variant} />
                <span>{tileName(tile)}</span>
                {isDisaster(tile.kind) && <small>灾难牌</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="receipt-empty">本次没有拼块，仅交换太阳圆盘。</p>
        )}
      </section>
      <p className="receipt-next">{next}</p>
      <div className="receipt-actions">
        <button className="secondary receipt-view" onClick={onViewWinner}>
          <Eye size={17} /> 查看赢家玩家板
        </button>
        <button className="primary receipt-continue" onClick={onContinue}>
          看清了，继续 <ArrowRight size={18} />
        </button>
      </div>
    </Dialog>
  );
}
