import { useLayoutEffect, useRef, useState } from "react";
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
  const [reading, setReading] = useState(
    () => window.matchMedia("(max-width: 650px)").matches,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const content = contentRef.current!;
    const fit = () => {
      setScale(
        Math.min(
          1,
          (viewport.clientHeight - 1) / Math.max(1, content.offsetHeight),
        ),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    observer.observe(content);
    fit();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    viewportRef.current!.scrollTop = 0;
  }, [player, reading]);

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
      <div className="score-board-toolbar">
        <p className="score-board-guide">
          点击上方玩家切换版图，点击牌面查看规则。
          {reading ? "可滚动查看全部计分。" : "已按窗口高度展示整张版图。"}
        </p>
        <div
          className="score-view-modes"
          role="group"
          aria-label="版图显示方式"
        >
          <button aria-pressed={!reading} onClick={() => setReading(false)}>
            完整总览
          </button>
          <button aria-pressed={reading} onClick={() => setReading(true)}>
            放大阅读
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`score-mat-viewport ${reading ? "is-reading" : ""}`}
        tabIndex={reading ? 0 : undefined}
        role="region"
        aria-label="玩家计分版图"
      >
        <div
          ref={contentRef}
          className="score-mat-content"
          style={{ transform: reading ? undefined : `scale(${scale})` }}
        >
          <PlayerMat
            state={state}
            player={player}
            onPlayer={onPlayer}
            scoring={explainScore(state, player)}
          />
        </div>
      </div>
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
