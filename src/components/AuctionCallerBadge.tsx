import { LayoutGrid } from "lucide-react";
import type { State } from "../game/types.ts";
import { Glyph } from "./Art.tsx";
import { TileArt } from "./TileArt.tsx";

export function AuctionCallerBadge({
  state,
  player,
}: {
  state: State;
  player: number;
}) {
  const auction = state.auction;
  if (!auction || auction.caller !== player) return null;
  const reason = auction.reason;
  const label =
    reason === "draw" ? "抽到 RA" : reason === "full" ? "满轨拍卖" : "主动呼唤";
  const description = `${state.players[player].name}是本轮拍卖发起者：${reason === "draw" ? "抽到太阳神，太阳船前进" : reason === "full" ? "拍卖轨已满，呼唤 RA 发起拍卖，太阳船不前进" : "主动呼唤 RA，太阳船不前进"}；发起者最后出价。`;
  return (
    <span
      className={`auction-caller-badge cause-${reason}`}
      role="img"
      aria-label={description}
      title={description}
    >
      {reason === "draw" ? (
        <TileArt kind="ra" />
      ) : reason === "full" ? (
        <LayoutGrid />
      ) : (
        <Glyph kind="ra" />
      )}
      <small>{label}</small>
    </span>
  );
}
