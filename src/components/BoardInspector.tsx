import { useLayoutEffect, useRef } from "react";
import type { Kind, State } from "../game/types.ts";
import { Dialog } from "./Dialog.tsx";
import { BoardOwnership } from "./BoardOwnership.tsx";
import { PlayerMat } from "./PlayerMat.tsx";
import "./BoardInspector.css";

export function BoardInspector({
  state,
  player,
  focus,
  onPlayer,
  onClose,
}: {
  state: State;
  player: number;
  focus: Kind | null;
  onPlayer: (player: number) => void;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = surface.current!;
    root.scrollTop = 0;
    if (focus)
      root.querySelector(`.mat-${focus}`)?.scrollIntoView({ block: "nearest" });
  }, [player, focus]);
  const settlement = state.phase === "epoch" || state.phase === "over";
  return (
    <Dialog
      title={`${state.players[player].name}的玩家板`}
      onClose={onClose}
      className="board-inspector"
      wide
    >
      <BoardOwnership state={state} player={player} onPlayer={onPlayer} />
      <nav className="inspection-players" aria-label="切换玩家板">
        {state.players.map((p, i) => (
          <button
            key={i}
            aria-pressed={i === player}
            onClick={() => onPlayer(i)}
          >
            {p.name}
          </button>
        ))}
      </nav>
      <div
        className="inspection-surface table-fit"
        ref={surface}
        data-focus={focus ?? undefined}
        tabIndex={0}
        role="region"
        aria-label="完整玩家板"
      >
        <PlayerMat state={state} player={player} showOwnership={false} />
      </div>
      <div className="inspection-footer">
        <span>
          {settlement
            ? `第 ${state.epoch} 纪元结束时的牌面`
            : "查看期间比赛已暂停"}
        </span>
        <button className="secondary" onClick={onClose}>
          {settlement ? "返回结算" : "返回牌桌"}
        </button>
      </div>
    </Dialog>
  );
}
