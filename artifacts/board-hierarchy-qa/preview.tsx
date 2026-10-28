import React from "react";
import { createRoot } from "react-dom/client";
import { PublicBoard } from "../../src/components/PublicBoard.tsx";
import { PlayerMat } from "../../src/components/PlayerMat.tsx";
import { newGame, advance } from "../../src/game/engine.ts";
import { describeMove } from "../../src/game/presentation.ts";
import "../../src/style.css";
import "../../src/tabletop.css";
const state = newGame({ count: 5, humans: 1, difficulty: "normal", seed: 42 });
state.epoch = 2;
state.ra = 2;
state.current = 1;
for (let variant = 0; variant < 8; variant++) {
  const tile = state.bag.find(
    (t) => t.kind === "monument" && t.variant === variant,
  )!;
  state.players[0].tiles.push(tile);
  state.bag = state.bag.filter((t) => t.id !== tile.id);
}
state.market = [
  state.bag.find((t) => t.kind === "monument" && t.variant === 5)!,
  state.bag.find((t) => t.kind === "civilization")!,
  state.bag.find((t) => t.kind === "gold")!,
];
state.bag = state.bag.filter((t) => !state.market.includes(t));
state.bag.push(
  ...state.bag.splice(
    state.bag.findIndex((t) => t.kind === "ra"),
    1,
  ),
);
const after = advance(state, { type: "draw" });
const latest = describeMove(state, { type: "draw" }, after);
createRoot(document.getElementById("root")!).render(
  <main
    className="table-fit"
    style={{ maxWidth: 1120, margin: "0 auto", padding: 16 }}
  >
    <PublicBoard
      state={after}
      latest={latest}
      moving={false}
      canExchange={false}
      selected={[]}
      onSelect={() => {}}
    />
    <div style={{ marginTop: 12 }}>
      <PlayerMat state={after} player={0} onPlayer={() => {}} />
    </div>
  </main>,
);
