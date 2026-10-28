import type { State } from "../game/types.ts";
import type { Move } from "../game/presentation.ts";
import { auctionNotice } from "../game/presentation.ts";
import { RA_LIMIT, tileLabel } from "../game/data.ts";
import { legalActions } from "../game/engine.ts";
import { Glyph } from "./Art.tsx";
import { Tile } from "./Tile.tsx";
import { TileArt } from "./TileArt.tsx";
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
  const notice = auctionNotice(state, latest);
  const exchangeIds = new Set(
    canExchange
      ? legalActions(state).flatMap((a) => (a.type === "god" ? [a.tileId] : []))
      : [],
  );
  return (
    <section className="public-board" aria-label="公共版图">
      <div className="pb-sky">
        <header className="pb-heading">
          <div className="pb-journey-heading">
            <div className="pb-journey-title">
              <Glyph kind="ra" />
              <b>太阳之旅</b>
              <span className="pb-progress-count">
                {state.ra} / {RA_LIMIT[state.config.count]} 格
              </span>
              <span className="pb-remaining">
                {state.ra === RA_LIMIT[state.config.count]
                  ? "纪元结束"
                  : `距结算还差 ${RA_LIMIT[state.config.count] - state.ra} 格`}
              </span>
            </div>
            <div
              className={`pb-track-context ${notice ? "pb-auction-context" : ""}`}
              role={notice ? "status" : undefined}
              aria-live="polite"
              aria-atomic="true"
              title={
                notice
                  ? `${notice.title}。${notice.detail} ${notice.status}`
                  : "抽到太阳神，太阳船前进；抵达终点立即结算。"
              }
            >
              {notice ? (
                <>
                  <span
                    className="pb-heading-symbol"
                    data-motion={
                      notice.kind === "ra" ? "ra-reveal" : "auction-notice"
                    }
                  >
                    {notice.kind === "ra" ? (
                      <TileArt kind="ra" />
                    ) : (
                      <Glyph kind="ra" />
                    )}
                  </span>
                  <span>
                    {notice.kind === "ra"
                      ? notice.title
                      : `${state.players[notice.actor].name}发起拍卖`}
                  </span>
                </>
              ) : (
                <span>抽到太阳神才前进 · 抵达终点立即结算</span>
              )}
            </div>
          </div>
          <div
            className="pb-epochs"
            aria-label={`当前第 ${state.epoch} 纪元，共 3 个纪元`}
          >
            {[1, 2, 3].map((e) => (
              <span
                key={e}
                aria-current={e === state.epoch ? "step" : undefined}
                className={
                  e === state.epoch ? "current" : e < state.epoch ? "past" : ""
                }
              >
                <b>{["I", "II", "III"][e - 1]}</b>
                <small>
                  {e === state.epoch
                    ? "当前纪元"
                    : e < state.epoch
                      ? "已结束"
                      : `第 ${e} 纪元`}
                </small>
              </span>
            ))}
          </div>
        </header>
        <div
          className="pb-track"
          data-motion="ra"
          role="progressbar"
          aria-label="太阳船进度"
          aria-valuemin={0}
          aria-valuemax={RA_LIMIT[state.config.count]}
          aria-valuenow={state.ra}
          aria-valuetext={`第 ${state.epoch} 纪元，太阳船位于第 ${state.ra} 格，距结算还差 ${RA_LIMIT[state.config.count] - state.ra} 格`}
        >
          <div className="pb-track-spaces">
            {Array.from(
              { length: RA_LIMIT[state.config.count] + 1 },
              (_, i) => (
                <div
                  key={i}
                  className={`pb-track-space ${i < state.ra ? "passed" : ""} ${i === state.ra ? "boat" : ""} ${i === RA_LIMIT[state.config.count] ? "last" : ""}`}
                >
                  <div className="pb-marker-slot">
                    <span className="pb-track-marker">
                      {i === state.ra ? (
                        <SunBoat />
                      ) : i === RA_LIMIT[state.config.count] ? (
                        <Glyph kind="ra" />
                      ) : (
                        i || "起"
                      )}
                    </span>
                  </div>
                  <span className="pb-track-caption">
                    {i === RA_LIMIT[state.config.count]
                      ? "纪元结算"
                      : i === state.ra
                        ? i
                          ? `第 ${i} 格`
                          : "起点"
                        : ""}
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
          <div
            className={`pb-last ${state.lastTile?.kind === "ra" ? "ra-discarded" : ""}`}
          >
            {state.lastTile?.kind === "ra" && (
              <div className="pb-last-ra">
                <TileArt kind="ra" />
              </div>
            )}
            <div>
              <span>上次抽取</span>
              <b title={state.lastTile ? tileLabel(state.lastTile) : undefined}>
                {state.lastTile ? tileLabel(state.lastTile) : "尚未抽牌"}
              </b>
              {state.lastTile?.kind === "ra" && (
                <small>已弃置 · 不计入拍品</small>
              )}
            </div>
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

function SunBoat() {
  return (
    <svg
      className="pb-boat-art"
      viewBox="0 0 64 54"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 37q27 15 54 0l-8 12H14z" fill="#d29b38" />
      <path d="M32 5v33M32 9 13 33h19z" fill="#fff0b8" />
      <path d="M37 9q20 5 17 21l-17 5z" fill="#f7d278" />
      <path d="M9 40 5 31m50 9 4-9M17 49h32M10 52h43" />
      <circle cx="47" cy="8" r="5" fill="#f5cb66" strokeWidth="1.8" />
    </svg>
  );
}
