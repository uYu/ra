import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuctionCallerBadge } from "../../src/components/AuctionCallerBadge.tsx";
import { PublicBoard } from "../../src/components/PublicBoard.tsx";
import { Glyph } from "../../src/components/Art.tsx";
import { newGame, advance } from "../../src/game/engine.ts";
import { describeMove } from "../../src/game/presentation.ts";
import "../../src/style.css";
import "../../src/tabletop.css";
function fixture(reason: "draw" | "invoke" | "full") {
  const before = newGame({
    count: 4,
    humans: 1,
    difficulty: "normal",
    seed: 42,
  });
  before.current = 1;
  if (reason === "full") {
    before.market = before.bag.filter((t) => t.kind !== "ra").slice(0, 8);
    before.bag = before.bag.filter((t) => !before.market.includes(t));
  }
  before.bag.push(
    ...before.bag.splice(
      before.bag.findIndex((t) => t.kind === "ra"),
      1,
    ),
  );
  const action = {
    type: reason === "draw" ? ("draw" as const) : ("invoke" as const),
  };
  const state = advance(before, action);
  return { state, latest: describeMove(before, action, state) };
}
function Preview() {
  const [view, setView] = useState(() => fixture("draw"));
  const { state, latest } = view;
  return (
    <main
      className="table-fit"
      style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}
    >
      <nav style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        {(["draw", "invoke", "full"] as const).map((reason) => (
          <button onClick={() => setView(fixture(reason))} key={reason}>
            {
              { draw: "抽到太阳神", invoke: "主动呼唤", full: "满轨拍卖" }[
                reason
              ]
            }
          </button>
        ))}
        <button
          onClick={() => {
            if (state.auction) {
              const after = advance(state, { type: "bid", sun: null });
              setView({
                state: after,
                latest: describeMove(state, { type: "bid", sun: null }, after),
              });
            }
          }}
        >
          下一位弃权
        </button>
      </nav>
      <div className="game-layout">
        <PublicBoard
          state={state}
          latest={latest}
          moving={false}
          canExchange={false}
          selected={[]}
          onSelect={() => {}}
        />
        <aside className="table-sidebar">
          <section className="player-strip">
            {state.players.map((p, i) => (
              <button
                key={i}
                className={`player-summary ${state.current === i ? "current" : ""} ${state.auction?.caller === i ? "is-auction-caller" : ""}`}
              >
                <AuctionCallerBadge state={state} player={i} />
                <span className={`avatar avatar-${i}`}>
                  <Glyph kind="pharaoh" />
                </span>
                <div className="player-meta">
                  <b>
                    {p.name} <small>{p.human ? "玩家" : "AI"}</small>
                  </b>
                  <span>{p.suns.length} 枚圆盘可用</span>
                </div>
                <div className="mini-disks">
                  {p.suns.map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                </div>
                {state.current === i && <span className="turn-dot" />}
              </button>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
