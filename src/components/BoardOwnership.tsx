import { Eye, Home } from "lucide-react";
import type { State } from "../game/types.ts";
import "./BoardOwnership.css";

export function BoardOwnership({
  state,
  player,
  onPlayer,
  onHome,
}: {
  state: State;
  player: number;
  onPlayer?: (player: number) => void;
  onHome?: () => void;
}) {
  const solo = state.config.humans === 1;
  const own = solo ? state.players.findIndex((p) => p.human) : -1;
  const other = solo ? player !== own : state.current !== player;
  const inPlay = ["turn", "auction", "god", "disaster"].includes(state.phase);
  const home = solo ? own : inPlay ? state.current : -1;
  const label = solo
    ? other
      ? "正在查看他人棋盘"
      : "正在查看我的棋盘"
    : state.config.humans === 0
      ? "旁观 · 正在查看"
      : "正在查看玩家棋盘";
  const canReturn = home >= 0 && player !== home && !!(onPlayer || onHome);
  return (
    <div
      className={`board-owner-band ${other ? "is-other" : "is-own"}`}
      role="status"
      aria-label={`${label}：${state.players[player].name}`}
    >
      <Eye aria-hidden="true" size={20} />
      <div className="board-owner-copy">
        <span>{label}</span>
        <strong>{state.players[player].name}的棋盘</strong>
      </div>
      {canReturn && (
        <button
          className="board-owner-return"
          onClick={() => (onHome ? onHome() : onPlayer?.(home))}
        >
          <Home size={15} aria-hidden="true" />
          {solo ? "返回我的棋盘" : "查看行动玩家"}
        </button>
      )}
    </div>
  );
}
