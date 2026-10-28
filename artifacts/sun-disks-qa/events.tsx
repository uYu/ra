import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicBoard } from "../../src/components/PublicBoard.tsx";
import {
  ActionMotion,
  captureAnchors,
} from "../../src/components/ActionMotion.tsx";
import type { Motion } from "../../src/components/ActionMotion.tsx";
import { advance, newGame } from "../../src/game/engine.ts";
import { describeMove } from "../../src/game/presentation.ts";
import { RA_LIMIT } from "../../src/game/data.ts";
import type { Action } from "../../src/game/types.ts";
import "../../src/style.css";
import "../../src/tabletop.css";

function scenario(kind: "draw" | "invoke" | "final") {
  const before = newGame({
    count: 4,
    humans: 1,
    difficulty: "normal",
    seed: 42,
  });
  before.current = 1;
  before.ra = kind === "final" ? RA_LIMIT[4] - 1 : 2;
  const tiles = before.bag
    .filter((t) => ["gold", "nile", "monument"].includes(t.kind))
    .slice(0, 3);
  before.market = tiles;
  before.bag = before.bag.filter((t) => !tiles.includes(t));
  before.bag.push(
    ...before.bag.splice(
      before.bag.findIndex((t) => t.kind === "ra"),
      1,
    ),
  );
  const action: Action = { type: kind === "invoke" ? "invoke" : "draw" };
  const state = advance(before, action);
  return { before, action, state, latest: describeMove(before, action, state) };
}
function Preview() {
  const [view, setView] = useState(() => scenario("draw"));
  const [motion, setMotion] = useState<Motion | null>(null);
  function show(kind: "draw" | "invoke" | "final") {
    const next = scenario(kind);
    setMotion({
      id: performance.now(),
      before: next.before,
      after: next.state,
      action: next.action,
      origins: captureAnchors(),
    });
    setView(next);
  }
  function bid() {
    if (view.state.phase !== "auction") return;
    const action: Action = { type: "bid", sun: null };
    const next = advance(view.state, action);
    setView({
      ...view,
      state: next,
      latest: describeMove(view.state, action, next),
    });
  }
  return (
    <main
      className="table-fit"
      style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}
    >
      <nav style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <button onClick={() => show("draw")}>抽到太阳神</button>
        <button onClick={() => show("invoke")}>他人呼唤 RA</button>
        <button onClick={bid}>后续玩家弃权</button>
        <button onClick={() => show("final")}>抽到最后一张太阳神</button>
      </nav>
      <PublicBoard
        state={view.state}
        latest={view.latest}
        moving={!!motion}
        canExchange={false}
        selected={[]}
        onSelect={() => {}}
      />
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
