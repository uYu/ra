import type { Move } from "../game/presentation.ts";
import { useContext, useEffect, useState } from "react";
import type { Kind, State } from "../game/types.ts";
import { LABEL, tileName } from "../game/data.ts";
import { collectionProgress } from "../game/tile-guide.ts";
import { TileInfoContext } from "./Tile.tsx";
import { useTileTooltip } from "./TileTooltip.tsx";
import { TileArt } from "./TileArt.tsx";
import { Sun } from "./Art.tsx";
import { canInspectUsedSuns } from "../game/visibility.ts";
import type { ScoreBreakdown } from "../game/scoring-presentation.ts";
import { signedScore } from "../game/scoring-presentation.ts";
const RULE: Partial<Record<Kind, string>> = {
  monument: "终局：不同种类 + 同类成套",
  pharaoh: "每纪元：最多 +5 / 最少 −2",
  nile: "有洪水时，每块 +1",
  god: "换 1 块牌 / 保留每块 +2",
  gold: "每块 +3 分",
  civilization: "3 / 4 / 5 种 → 5 / 10 / 15 分",
  flood: "每块 +1，激活尼罗河",
};
export function PlayerMat({
  state,
  player,
  onPlayer,
  latest,
  unread = {},
  onHome,
  bidding,
  scoring,
}: {
  state: State;
  player: number;
  onPlayer: (i: number) => void;
  latest?: Move;
  unread?: Record<number, Move>;
  onHome?: () => void;
  scoring?: ScoreBreakdown;
  bidding?: {
    enabled: boolean;
    high: number;
    selected: number | null;
    onSelect: (sun: number) => void;
    onBid: (sun: number) => void;
  };
}) {
  const hints = useTileTooltip();
  const [peekedSun, setPeekedSun] = useState<number | null>(null);
  useEffect(() => {
    setPeekedSun(null);
  }, [player, state.current, state.epoch, state.config.seed]);
  const p = state.players[player],
    inspect = useContext(TileInfoContext);
  const canPeek = canInspectUsedSuns(state, player);
  const receiving =
    !!latest &&
    ["win", "god"].includes(latest.kind) &&
    (latest.winner ?? latest.actor) === player;
  const iconLabel = (kind: Kind, v: number) =>
    kind === "monument"
      ? `${v + 1}·${
          [
            "阶梯塔",
            "狮身像",
            "金字塔",
            "方尖碑",
            "雕像",
            "陵墓",
            "圣祠",
            "神庙",
          ][v]
        }`
      : tileName({ id: -1, kind, variant: v });
  function group(kind: Kind) {
    const tiles = p.tiles.filter((t) => t.kind === kind),
      variants = new Map<number, { id: number; count: number }>();
    for (const t of tiles) {
      const old = variants.get(t.variant);
      variants.set(t.variant, { id: t.id, count: (old?.count ?? 0) + 1 });
    }
    return (
      <div
        data-motion={`group-${player}-${kind}`}
        className={`mat-group mat-${kind} ${receiving && latest!.tiles.some((t) => t.kind === kind) ? "just-received" : ""}`}
        key={kind}
      >
        <div className="mat-category">
          <button
            onMouseEnter={(e) =>
              hints.show(
                { id: -1, kind, variant: 0 },
                e.currentTarget,
                collectionProgress(p, kind),
              )
            }
            onMouseLeave={hints.hide}
            onFocus={(e) =>
              hints.show(
                { id: -1, kind, variant: 0 },
                e.currentTarget,
                collectionProgress(p, kind),
              )
            }
            onBlur={hints.hide}
            aria-describedby={hints.id}
            onClick={() => {
              hints.hide();
              inspect({ id: -1, kind, variant: 0 });
            }}
            aria-label={`查看${LABEL[kind]}计分规则`}
          >
            {LABEL[kind]} <small>ⓘ</small>
          </button>
          <b>{tiles.length}</b>
        </div>
        <div className="mat-body">
          <div className="mat-rule">{RULE[kind]}</div>
          <div className="mat-pieces">
            {Array.from(
              {
                length:
                  kind === "monument" ? 8 : kind === "civilization" ? 5 : 1,
              },
              (_, variant) => {
                const g = variants.get(variant) ?? { id: -1, count: 0 };
                const tile = { id: g.id, kind, variant };
                const newly =
                  receiving &&
                  latest!.tiles.some(
                    (t) => t.kind === kind && t.variant === variant,
                  );
                return (
                  <button
                    key={variant}
                    data-motion={`owned-${player}-${kind}-${variant}`}
                    className={`mat-piece ${g.count ? "collected" : "uncollected"} ${newly ? "new-owned-tile" : ""}`}
                    onMouseEnter={(e) =>
                      hints.show(
                        tile,
                        e.currentTarget,
                        `${LABEL[kind]} · ${tileName(tile)} · 持有 ${g.count} 块；${collectionProgress(p, kind)}`,
                      )
                    }
                    onMouseLeave={hints.hide}
                    onFocus={(e) =>
                      hints.show(
                        tile,
                        e.currentTarget,
                        `${LABEL[kind]} · ${tileName(tile)} · 持有 ${g.count} 块；${collectionProgress(p, kind)}`,
                      )
                    }
                    onBlur={hints.hide}
                    aria-describedby={hints.id}
                    onClick={() => {
                      hints.hide();
                      inspect(tile);
                    }}
                    aria-label={`查看${LABEL[kind]}${kind === "monument" ? ` ${variant + 1} 号` : ""}·${tileName(tile)}，${g.count ? "持有" + g.count + "块" : "未收集"}`}
                  >
                    <span className="piece-picture">
                      <TileArt kind={kind} variant={variant} />
                      <span className="piece-count">{g.count || "–"}</span>
                    </span>
                    <span className="piece-label">
                      {iconLabel(kind, variant)}
                    </span>
                    {newly && <em>新</em>}
                  </button>
                );
              },
            )}
          </div>
        </div>
        <span className="mat-progress" title={collectionProgress(p, kind)}>
          {collectionProgress(p, kind)}
        </span>
        {scoring?.groups[kind] && (
          <div className="mat-score-explanation">
            <b
              className={
                scoring.groups[kind]!.points === null
                  ? "deferred"
                  : scoring.groups[kind]!.points! < 0
                    ? "negative"
                    : ""
              }
            >
              {scoring.groups[kind]!.points === null
                ? "待终局"
                : `${signedScore(scoring.groups[kind]!.points!)} 分`}
            </b>
            <span>{scoring.groups[kind]!.reason}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <section className="player-mat">
      {hints.tooltip}
      <header>
        <div className="mat-heading">
          <h2>{p.name}的玩家板</h2>
          {onHome && (
            <button className="back-to-own" onClick={onHome}>
              返回我的棋盘
            </button>
          )}
        </div>
        {!scoring && (
          <nav>
            {state.players.map((q, i) => (
              <button
                key={i}
                className={i === player ? "selected" : ""}
                onClick={() => onPlayer(i)}
              >
                {q.name}
                {unread[i] && (
                  <small className="unread-acquisition" title="有新收获">
                    ●
                  </small>
                )}
              </button>
            ))}
          </nav>
        )}
      </header>
      <div className="mat-board">
        <div className="mat-permanent">
          <span className="mat-side-label">永久牌 · 跨纪元保留</span>
          {(["monument", "pharaoh", "nile"] as Kind[]).map(group)}
        </div>
        <div className="mat-center">
          <span>太阳圆盘</span>
          <div
            className="mat-suns"
            style={{
              gridTemplateRows: `repeat(${p.suns.length + p.used.length}, minmax(0, 68px))`,
            }}
          >
            {[...p.suns]
              .sort((a, b) => a - b)
              .map((n) =>
                bidding ? (
                  <button
                    type="button"
                    className={`mat-sun selectable ${bidding.selected === n ? "selected" : ""}`}
                    key={n}
                    disabled={!bidding.enabled || n <= bidding.high}
                    aria-label={`选择玩家板太阳圆盘 ${n} 出价`}
                    aria-pressed={bidding.selected === n}
                    title={
                      n <= bidding.high
                        ? `不能出价：不高于当前最高 ${bidding.high}`
                        : `选择 ${n} 出价`
                    }
                    onClick={() => bidding.onSelect(n)}
                  >
                    <b>{n}</b>
                    <small>
                      {n <= bidding.high
                        ? "无法跟价"
                        : bidding.selected === n
                          ? "已选择"
                          : "可出价"}
                    </small>
                  </button>
                ) : (
                  <div className="mat-sun" key={n}>
                    <b>{n}</b>
                    <small>{scoring ? "未使用" : "可出价"}</small>
                  </div>
                ),
              )}
            {p.used.map((n, i) => {
              const shown =
                state.phase === "over" || (canPeek && peekedSun === n);
              const face = (
                <>
                  {shown ? <b>{n}</b> : <Sun className="sun-back" />}
                  <small>
                    {shown ? "已暗扣" : canPeek ? "点击查看" : "已暗扣"}
                  </small>
                </>
              );
              return canPeek && state.phase !== "over" ? (
                <button
                  type="button"
                  className={`mat-sun spent peekable ${shown ? "peeked" : ""}`}
                  key={n}
                  aria-label={
                    shown
                      ? `自己的暗扣圆盘 ${n}，本纪元不可用，点击扣回`
                      : `查看自己的第 ${i + 1} 枚暗扣圆盘面值`
                  }
                  aria-pressed={shown}
                  title="仅自己可查看；本纪元不可用，下纪元恢复"
                  onClick={() => setPeekedSun(shown ? null : n)}
                  onBlur={() => setPeekedSun(null)}
                >
                  {face}
                </button>
              ) : (
                <div
                  className={`mat-sun spent ${shown ? "peeked" : ""}`}
                  key={n}
                  role="img"
                  aria-label={
                    shown ? `太阳圆盘 ${n}` : "其他玩家的暗扣圆盘，面值不可查看"
                  }
                >
                  {face}
                </div>
              );
            })}
          </div>
          {p.used.length > 0 && (
            <div className="mat-spent-hint">
              {state.phase === "over"
                ? "终局 · 圆盘全部计分"
                : "暗扣 · 本纪元不可用"}
              <br />
              {state.phase === "over"
                ? "展示全部面值"
                : canPeek
                  ? "自己的可点击查看"
                  : "他人面值不可查看"}
            </div>
          )}
          {bidding && (
            <div className="mat-bid-action">
              {bidding.selected !== null ? (
                <button
                  className="mat-confirm-bid"
                  disabled={
                    !bidding.enabled || bidding.selected <= bidding.high
                  }
                  onClick={() => bidding.onBid(bidding.selected!)}
                >
                  确认出价 {bidding.selected}
                </button>
              ) : (
                <span>点圆盘选择出价</span>
              )}
            </div>
          )}
          <div className="mat-end-score">
            {scoring ? (
              <>
                <b
                  className={
                    scoring.sun.points !== null && scoring.sun.points < 0
                      ? "negative"
                      : ""
                  }
                >
                  {scoring.sun.points === null
                    ? "太阳 · 待终局"
                    : `太阳 ${signedScore(scoring.sun.points)} 分`}
                </b>
                <span>{scoring.sun.reason}</span>
              </>
            ) : (
              <>
                终局圆盘总和
                <br />
                最高 +5 · 最低 −5
              </>
            )}
          </div>
        </div>
        <div className="mat-temporary">
          <span className="mat-side-label">临时牌 · 每纪元结算后弃置</span>
          {(["god", "gold", "civilization", "flood"] as Kind[]).map(group)}
        </div>
      </div>
    </section>
  );
}
