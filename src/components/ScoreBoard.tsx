import { useState } from "react";
import type { Kind, State } from "../game/types.ts";
import { explainScore, signedScore } from "../game/scoring-presentation.ts";
import { Crown, ChevronDown, Eye } from "lucide-react";
import { ranking } from "../game/engine.ts";
import { LABEL } from "../game/data.ts";
import { TileArt } from "./TileArt.tsx";
import { Sun } from "./Art.tsx";
import "./ScoreBoard.css";

const ITEMS = [
  "monument",
  "pharaoh",
  "nile",
  "flood",
  "god",
  "gold",
  "civilization",
  "sun",
] as const;
type Item = (typeof ITEMS)[number];
export function ScoreBoard({
  state,
  player,
  onPlayer,
  onBoard,
}: {
  state: State;
  player: number;
  onPlayer: (player: number) => void;
  onBoard: (kind?: Kind) => void;
}) {
  const [expanded, setExpanded] = useState<Item | null>(null);
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
  const detail = explainScore(state, player);
  const p = state.players[player];
  const count = (kind: Kind) => p.tiles.filter((t) => t.kind === kind).length;
  const kinds = (kind: Kind) =>
    new Set(p.tiles.filter((t) => t.kind === kind).map((t) => t.variant)).size;
  const reason = (item: Item) =>
    item === "sun" ? detail.sun : detail.groups[item]!;
  const caption = (item: Item) => {
    if (item === "monument") return `${count(item)} 块 · ${kinds(item)} 种`;
    if (item === "civilization") return `${count(item)} 块 · ${kinds(item)} 种`;
    if (item === "sun")
      return final
        ? `圆盘总和 ${[...p.suns, ...p.used].reduce((a, b) => a + b, 0)}`
        : `${p.suns.length + p.used.length} 枚 · 第三纪元计分`;
    if (item === "nile")
      return `${count(item)} 块 · ${count("flood") ? "洪水已激活" : "没有洪水"}`;
    if (item === "pharaoh") {
      const all = state.players.map(
        (q) => q.tiles.filter((t) => t.kind === "pharaoh").length,
      );
      return `${count(item)} 块 · ${Math.min(...all) === Math.max(...all) ? "全场持平" : count(item) === Math.max(...all) ? "全场最多" : count(item) === Math.min(...all) ? "全场最少" : "数量居中"}`;
    }
    return `${count(item)} 块 × ${item === "gold" ? 3 : item === "god" ? 2 : 1} 分`;
  };
  return (
    <section className="score-settlement" aria-label="各项计分总览">
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
      <div className="settlement-heading">
        <h3>{row.name}的计分</h3>
        <button className="secondary" onClick={() => onBoard()}>
          <Eye size={16} /> 查看玩家板
        </button>
      </div>
      <div className="score-items">
        {ITEMS.map((item) => {
          const score = reason(item);
          return (
            <button
              key={item}
              data-score-kind={item}
              aria-expanded={expanded === item}
              className={`score-item ${score.points !== null && score.points < 0 ? "is-negative" : ""} ${expanded === item ? "is-expanded" : ""}`}
              onClick={() => setExpanded(expanded === item ? null : item)}
            >
              <span className="score-item-art">
                {item === "sun" ? (
                  <Sun />
                ) : (
                  <TileArt kind={item} variant={item === "monument" ? 2 : 0} />
                )}
              </span>
              <b>{item === "sun" ? "太阳圆盘" : LABEL[item]}</b>
              <strong>
                {score.points === null ? (
                  <small>待终局</small>
                ) : (
                  <>
                    {signedScore(score.points)}
                    <small>分</small>
                  </>
                )}
              </strong>
              <span className="score-item-caption">{caption(item)}</span>
            </button>
          );
        })}
      </div>
      {expanded && (
        <div className="score-item-reason" role="status">
          <b>
            {expanded === "sun" ? "太阳圆盘" : LABEL[expanded]} ·{" "}
            {reason(expanded).points === null
              ? "第三纪元计分"
              : `${signedScore(reason(expanded).points!)} 分`}
          </b>
          <p>{reason(expanded).reason}</p>
          <button
            onClick={() => onBoard(expanded === "sun" ? undefined : expanded)}
          >
            查看对应牌面 <Eye size={14} />
          </button>
          <button
            className="score-reason-close"
            onClick={() => setExpanded(null)}
            aria-label="收起计算说明"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      )}
      <div className="score-total" role="status">
        <span>{row.name} · 本纪元合计</span>
        <strong className={row.delta < 0 ? "negative" : ""}>
          {signedScore(row.delta)} 分
        </strong>
        <b>{showTotal(player) ? `累计 ${row.total} 分` : "累计分数隐藏"}</b>
        {showTotal(player) && (
          <small>
            此前 {previous} 分 {row.delta < 0 ? "−" : "+"} {Math.abs(row.delta)}{" "}
            分{previous + row.delta < 0 && "（总分最低为 0）"}
          </small>
        )}
      </div>
    </section>
  );
}
