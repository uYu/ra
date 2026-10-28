import type { Action, Save, State, Tile } from "./types.ts";
import { advance, newGame } from "./engine.ts";
import { tileLabel as tileName } from "./data.ts";
export type Move = {
  step: number;
  actor: number;
  title: string;
  detail: string;
  tiles: Tile[];
  kind:
    | "draw"
    | "invoke"
    | "bid"
    | "pass"
    | "win"
    | "god"
    | "discard"
    | "finish"
    | "next";
  winner?: number;
};
export function describeMove(
  before: State,
  action: Action,
  after: State,
): Move {
  const actor = before.current,
    name = before.players[actor].name,
    move: Move = {
      step: after.steps,
      actor,
      title: "",
      detail: "",
      tiles: [],
      kind: "draw",
    };
  switch (action.type) {
    case "draw": {
      const t = after.lastTile!;
      move.title = `${name}抽到${tileName(t)}`;
      move.tiles = [t];
      move.detail =
        t.kind === "ra"
          ? after.phase === "epoch" || after.phase === "over"
            ? "太阳船到达终点：本纪元立即结算，不再拍卖。"
            : `太阳船前进至 ${after.ra} 格，开始竞价。`
          : `放入第 ${after.market.length} 个拍卖位；当前整批 ${after.market.length} 块。`;
      break;
    }
    case "invoke":
      move.kind = "invoke";
      move.title = `${name}呼唤 RA`;
      move.detail = `发起 ${before.market.length} 块拍品的拍卖，从发起者下家开始出价。`;
      break;
    case "bid": {
      move.kind = action.sun === null ? "pass" : "bid";
      move.title =
        action.sun === null ? `${name}放弃出价` : `${name}出价 ${action.sun}`;
      move.detail =
        action.sun === null
          ? "保留全部太阳圆盘，本次不再参与。"
          : "只有最终赢家会花掉圆盘；其他出价圆盘仍可使用。";
      if (!after.auction) {
        const a = before.auction!,
          winner = action.sun !== null ? actor : a.winner,
          sun = action.sun ?? a.high;
        if (winner >= 0) {
          move.kind = "win";
          move.winner = winner;
          move.title = `${before.players[winner].name}以 ${sun} 赢得拍卖`;
          move.tiles = before.market;
          move.detail = `${name}${action.sun === null ? "弃权" : `出价 ${action.sun}`}，竞价结束。赢家取得 ${before.market.length} 块牌，支付 ${sun}，换回已使用圆盘 ${before.center}。`;
        } else {
          move.detail =
            a.reason === "full"
              ? "全部弃权：满轨拍品全部清空，中央圆盘保留。"
              : "全部弃权：拍品和中央圆盘留在原处。";
        }
      }
      break;
    }
    case "god": {
      move.kind = "god";
      const t = before.market.find((t) => t.id === action.tileId)!;
      move.title = `${name}用神祇换取${tileName(t)}`;
      move.detail = "花掉 1 块神祇，不消耗太阳圆盘；仍可继续换牌。";
      move.tiles = [t];
      break;
    }
    case "discard":
      move.kind = "discard";
      move.title = `${name}弃置 ${action.ids.length} 块牌`;
      move.tiles = before.players[actor].tiles.filter((t) =>
        action.ids.includes(t.id),
      );
      move.detail = "处理刚获得的灾难，这些牌永久移出游戏。";
      break;
    case "finish":
      move.kind = "finish";
      move.title = `${name}结束神祇行动`;
      move.detail = "换牌结束，由下一个有可用圆盘的玩家继续。";
      break;
    case "next":
      move.kind = "next";
      move.title = `第 ${after.epoch} 纪元开始`;
      move.detail = `全部圆盘恢复可用，由${after.players[after.current].name}先行。`;
      break;
  }
  return move;
}
export function recentMoves(
  save: Save,
  limit = save.actions.length,
  keep = 10,
): Move[] {
  let state = newGame(save.config);
  const out: Move[] = [];
  const actions = save.actions.slice(0, limit);
  for (let i = 0; i < actions.length; i++) {
    const after = advance(state, actions[i]);
    if (i >= actions.length - keep)
      out.push(describeMove(state, actions[i], after));
    state = after;
  }
  return out;
}
