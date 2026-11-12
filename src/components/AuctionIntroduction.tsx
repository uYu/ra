import { ArrowRight, Gavel } from "lucide-react";
import type { State } from "../game/types.ts";
import { Dialog } from "./Dialog.tsx";
import { TileArt } from "./TileArt.tsx";
import "./AuctionIntroduction.css";

export function AuctionIntroduction({
  state,
  onContinue,
}: {
  state: State;
  onContinue: () => void;
}) {
  const auction = state.auction;
  if (!auction) return null;
  const drawn = auction.reason === "draw";
  const owner = state.players[auction.caller].name;
  const bidder = state.players[state.current].name;
  return (
    <Dialog
      title={
        drawn
          ? "太阳神现身 · 拍卖开始"
          : auction.reason === "full"
            ? "拍卖轨已满 · 开始拍卖"
            : "呼唤 RA · 开始拍卖"
      }
      onClose={onContinue}
      className="auction-introduction"
    >
      <div className="auction-intro-hero">
        <div className="auction-intro-art">
          {drawn ? <TileArt kind="ra" /> : <Gavel aria-hidden="true" />}
        </div>
        <div>
          <strong>{owner}</strong>
          <p>{drawn ? "抽到了太阳神" : "发起了本轮拍卖"}</p>
        </div>
      </div>
      <p className="auction-intro-cause">
        {drawn
          ? "太阳船前进一格；太阳神牌已弃置，不加入拍品。"
          : "太阳船保持原位，拍卖桌上的整批拼块。"}
      </p>
      <div className="auction-intro-next">
        <span>接下来轮到</span>
        <strong>{bidder}</strong>
        <span>首先出价</span>
      </div>
      <div className="auction-intro-lot">
        <b>{state.market.length} 块拍品</b>
        <span>中央太阳 {state.center}</span>
      </div>
      <p className="auction-intro-rule">
        每人只有一次出价机会；发起者最后出价。
      </p>
      <button className="primary auction-intro-continue" onClick={onContinue}>
        开始出价 <ArrowRight size={20} />
      </button>
    </Dialog>
  );
}
