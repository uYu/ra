import type { State } from "../game/types.ts";
import type { Move } from "../game/presentation.ts";
import { RA_LIMIT, tileLabel } from "../game/data.ts";
import { legalActions } from "../game/engine.ts";
import { Glyph } from "./Art.tsx";
import { Tile } from "./Tile.tsx";
import "./PublicBoard.css";

export function PublicBoard({
  state,
  latest,
  moving,
  canExchange,
  selected,
  onSelect,
}: {
  state: State;
  latest?: Move;
  moving: boolean;
  canExchange: boolean;
  selected: number[];
  onSelect: (id: number) => void;
}) {
  const exchangeIds = new Set(
    canExchange
      ? legalActions(state).flatMap((a) => (a.type === "god" ? [a.tileId] : []))
      : [],
  );
  return (
    <section className="public-board" aria-label="公共版图">
      <div className="pb-sky">
        <header className="pb-heading">
          <b>太阳轨道 · 抽到 RA 才前进</b>
          <div className="pb-stars" aria-hidden="true">
            ✶ ✶ ✶ ✶ ✶ ✶ ✶ ✶ ✶ ✶ ✶ ✶
          </div>
          <div className="pb-epochs" aria-label={`第 ${state.epoch} 纪元`}>
            {[1, 2, 3].map((e) => (
              <span
                key={e}
                className={
                  e === state.epoch ? "current" : e < state.epoch ? "past" : ""
                }
              >
                {["I", "II", "III"][e - 1]}
                <small>纪元</small>
              </span>
            ))}
          </div>
        </header>
        <div
          className="pb-track"
          data-motion="ra"
          aria-label={`太阳轨道 ${state.ra} / ${RA_LIMIT[state.config.count]}`}
        >
          <div className="pb-track-label">
            <Glyph kind="ra" />
            <span>太阳之旅</span>
          </div>
          <div className="pb-track-spaces">
            {Array.from(
              { length: RA_LIMIT[state.config.count] + 1 },
              (_, i) => (
                <div
                  key={i}
                  className={`pb-track-space ${i < state.ra ? "passed" : ""} ${i === state.ra ? "boat" : ""} ${i === RA_LIMIT[state.config.count] ? "last" : ""}`}
                >
                  <span>
                    {i === state.ra
                      ? "𓊝"
                      : i === RA_LIMIT[state.config.count]
                        ? "𓂀"
                        : i || "起"}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <div className="pb-body">
        <div className="pb-auction">
          <div className="pb-lot-heading">
            <span>
              <b>整批拍卖</b> · 点击牌查看功能
            </span>
            <span>{state.market.length} / 8 拍品</span>
          </div>
          <div className="pb-market">
            {Array.from({ length: 8 }, (_, i) => {
              const t = state.market[i],
                isNew =
                  !!t &&
                  latest?.kind === "draw" &&
                  latest.tiles.some((x) => x.id === t.id);
              return t ? (
                <div
                  key={t.id}
                  data-motion={`tile-${t.id}`}
                  className={`pb-slot ${isNew ? "is-new" : ""}`}
                >
                  <Tile
                    tile={t}
                    selected={selected.includes(t.id)}
                    onClick={
                      exchangeIds.has(t.id) ? () => onSelect(t.id) : undefined
                    }
                  />
                  {isNew && <span className="pb-new-tag">刚抽到</span>}
                </div>
              ) : (
                <div
                  className="pb-slot empty"
                  key={`empty-${i}`}
                  aria-label={`空拍卖位 ${i + 1}`}
                >
                  <svg
                    width="80"
                    height="105"
                    viewBox="0 0 80 105"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 5h70l-7 12H12zM15 17h50v80H15z"
                      fill="#b99358"
                      stroke="#eed599"
                    />
                    <path d="M24 21v71m16-71v71m16-71v71" stroke="#ead49d" />
                    <path
                      d="M5 9h70M12 33h56"
                      stroke="#789a85"
                      strokeWidth="4"
                    />
                    <circle
                      cx="40"
                      cy="52"
                      r="8"
                      fill="none"
                      stroke="#f1d89c"
                    />
                  </svg>
                  <small>{String(i + 1).padStart(2, "0")}</small>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="pb-dock" aria-label="拍卖信息">
          <div className="pb-center" data-motion="center">
            <span className="pb-sun">
              <b>{state.center}</b>
              <small>☼</small>
            </span>
            <div className="pb-center-copy">
              <b>中央太阳</b>
              <span>
                赢家换回
                <br />
                本纪元不可用
              </span>
            </div>
          </div>
          <div className="pb-counts">
            <span data-motion="bag">
              牌袋 <b>{state.bag.length}</b> 块
            </span>
            <span data-motion="discard">弃置 {state.discarded.length}</span>
          </div>
          <div className="pb-last">
            <span>上次抽取</span>
            <b title={state.lastTile ? tileLabel(state.lastTile) : undefined}>
              {state.lastTile ? tileLabel(state.lastTile) : "尚未抽牌"}
            </b>
          </div>
          <div
            className={`pb-event ${latest ? `kind-${latest.kind}` : "empty"}`}
            role="status"
            title={latest?.title}
          >
            <b>
              {latest
                ? `${moving ? "进行中 · " : ""}${latest.title}`
                : "等待第一步行动"}
            </b>
          </div>
        </aside>
      </div>
    </section>
  );
}
