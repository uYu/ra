import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicBoard } from "../../src/components/PublicBoard.tsx";
import { PlayerMat } from "../../src/components/PlayerMat.tsx";
import {
  ActionMotion,
  captureAnchors,
} from "../../src/components/ActionMotion.tsx";
import type { Motion } from "../../src/components/ActionMotion.tsx";
import { advance, newGame } from "../../src/game/engine.ts";
import { describeMove } from "../../src/game/presentation.ts";
import type { Move } from "../../src/game/presentation.ts";
import type { Action } from "../../src/game/types.ts";
import "../../src/style.css";
import "../../src/tabletop.css";
function baseline(full = false) {
  const state = newGame({
    count:
      new URLSearchParams(window.location.search).get("players") === "5"
        ? 5
        : 4,
    humans: 1,
    difficulty: "normal",
    seed: 42,
  });
  state.current = 0;
  state.epoch =
    new URLSearchParams(window.location.search).get("epoch") === "2" ? 2 : 1;
  state.market = state.bag
    .filter((t) => t.kind !== "ra")
    .slice(0, full ? 8 : 3);
  state.bag = state.bag.filter((t) => !state.market.includes(t));
  return state;
}
function Preview() {
  const [view, setView] = useState({
    state: baseline(),
    latest: undefined as Move | undefined,
  });
  const [motion, setMotion] = useState<Motion | null>(null);
  const [metrics, setMetrics] = useState({});
  useLayoutEffect(() => {
    setMetrics(
      Object.fromEntries(
        [".public-board", ".pb-market", ".action-panel", ".player-mat"].map(
          (selector) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return [selector, { y: r.y, height: r.height }];
          },
        ),
      ),
    );
  }, [view]);
  function start(reason: "draw" | "invoke" | "full") {
    const before = baseline(reason === "full");
    before.bag.push(
      ...before.bag.splice(
        before.bag.findIndex((t) => t.kind === "ra"),
        1,
      ),
    );
    const action: Action = { type: reason === "draw" ? "draw" : "invoke" };
    const state = advance(before, action);
    setMotion({
      id: performance.now(),
      before,
      after: state,
      action,
      origins: captureAnchors(),
    });
    setView({ state, latest: describeMove(before, action, state) });
  }
  function bid() {
    const before = view.state;
    if (!before.auction) return;
    const action: Action = {
      type: "bid",
      sun: before.auction.high
        ? null
        : Math.min(...before.players[before.current].suns),
    };
    const state = advance(before, action);
    setView({ state, latest: describeMove(before, action, state) });
  }
  return (
    <main
      className="table-fit"
      style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}
    >
      <nav
        style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}
      >
        <button
          onClick={() => {
            setView({ state: baseline(), latest: undefined });
            setMotion(null);
          }}
        >
          拍卖前
        </button>
        <button onClick={() => start("draw")}>抽到太阳神</button>
        <button onClick={() => start("invoke")}>主动呼唤</button>
        <button onClick={() => start("full")}>满轨拍卖</button>
        <button onClick={bid}>下一位出价</button>
      </nav>
      <div className="table-main">
        <PublicBoard
          state={view.state}
          latest={view.latest}
          moving={!!motion}
          canExchange={false}
          selected={[]}
          onSelect={() => {}}
        />
        <section className={`action-panel phase-${view.state.phase}`}>
          <div className="action-heading" style={{ display: "block" }}>
            <h2>{view.state.auction ? "拍卖进行中" : "普通回合"}</h2>
          </div>
          <div className="phase-actions">
            {view.state.auction
              ? "一轮出价，发起者最后行动。"
              : "抽取一块牌、呼唤 RA，或使用神祇。"}
          </div>
        </section>
        <PlayerMat state={view.state} player={0} onPlayer={() => {}} />
      </div>
      <output>{`布局测量: ${JSON.stringify(metrics)}`}</output>
      {motion && (
        <ActionMotion
          key={motion.id}
          motion={motion}
          paused={false}
          onDone={() => setMotion(null)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
