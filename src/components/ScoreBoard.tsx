import type { State } from "../game/types.ts";
import { explainScore, signedScore } from "../game/scoring-presentation.ts";
import { PlayerMat } from "./PlayerMat.tsx";
import { Crown } from "lucide-react";
import { ranking } from "../game/engine.ts";
import "./ScoreBoard.css";

export function ScoreBoard({
  state,
  player,
  onPlayer,
}: {
  state: State;
  player: number;
  onPlayer: (player: number) => void;
}) {
  const rows = state.history.at(-1)!;
  const row = rows[player];
  const showTotal = (i: number) =>
    state.phase === "over" || (state.config.humans === 1 && i === 0);
  const previous = state.history.at(-2)?.[player].total ?? 10;
  const final = state.phase === "over";
  const standings = final ? ranking(state) : [];
  const ownPlace =
    state.config.humans === 1
      ? standings.findIndex((entry) => state.players[entry.player].human) + 1
      : 0;
  return (
    <section
      className="score-settlement table-fit"
      aria-label="结合玩家版图的结算"
    >
      {final ? (
        <nav
          className="final-ranking"
          aria-label="最终排名，选择玩家查看结算版图"
        >
          <div className="final-ranking-heading">
            <h3>最终排名</h3>
            <p>
              {ownPlace
                ? `你获得第 ${ownPlace} 名 · 总分 ${standings[ownPlace - 1].score} 分`
                : "按最终总分排序"}
            </p>
          </div>
          <ol className="final-standings">
            {standings.map((entry, place) => {
              const r = rows[entry.player];
              const tied = standings.some(
                (other) =>
                  other.player !== entry.player && other.score === entry.score,
              );
              return (
                <li key={entry.player}>
                  <button
                    className={`${place === 0 ? "champion" : ""} ${entry.player === player ? "is-selected" : ""}`}
                    aria-pressed={entry.player === player}
                    onClick={() => onPlayer(entry.player)}
                  >
                    <span className="standing-place">第 {place + 1} 名</span>
                    {place === 0 && (
                      <span className="standing-champion">
                        <Crown size={14} aria-hidden="true" />
                        冠军
                      </span>
                    )}
                    <b className="standing-name">{r.name}</b>
                    <span className="standing-total">
                      <strong>{entry.score}</strong> <span>分</span>
                    </span>
                    <small className="standing-detail">
                      本纪元 {signedScore(r.delta)}
                      {tied && ` · 最大圆盘 ${entry.sun}`}
                    </small>
                    <span className="standing-selection">
                      {entry.player === player
                        ? "正在查看此玩家的版图"
                        : "点击查看版图"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : (
        <nav className="score-players" aria-label="选择玩家查看结算版图">
          {rows.map((r, i) => (
            <button
              key={i}
              className={i === player ? "selected" : ""}
              aria-pressed={i === player}
              onClick={() => onPlayer(i)}
            >
              <b>{r.name}</b>
              <span>
                本纪元{" "}
                <strong className={r.delta < 0 ? "negative" : ""}>
                  {signedScore(r.delta)}
                </strong>
              </span>
              <small>累计 {showTotal(i) ? `${r.total} 分` : "隐藏"}</small>
            </button>
          ))}
        </nav>
      )}
      <p className="score-board-guide">
        分数直接标在对应区域；点击牌面可查看规则，点击上方玩家可切换版图。
      </p>
      <PlayerMat
        state={state}
        player={player}
        onPlayer={onPlayer}
        scoring={explainScore(state, player)}
      />
      <div className="score-total" role="status">
        <span>{row.name} · 本纪元合计</span>
        <strong className={row.delta < 0 ? "negative" : ""}>
          {signedScore(row.delta)} 分
        </strong>
        {showTotal(player) && (
          <span>
            此前 {previous} 分 {row.delta < 0 ? "−" : "+"} {Math.abs(row.delta)}{" "}
            分 → 累计 <b>{row.total} 分</b>
            {previous + row.delta < 0 && "（总分最低为 0）"}
          </span>
        )}
      </div>
    </section>
  );
}
