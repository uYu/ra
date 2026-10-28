import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlayerMat } from "../../src/components/PlayerMat.tsx";
import { newGame } from "../../src/game/engine.ts";
import "../../src/style.css";
import "../../src/tabletop.css";

const state = newGame({ count: 3, humans: 1, difficulty: "normal", seed: 42 });
state.current = 0;
for (const p of state.players) p.used = p.suns.splice(2);
state.players[0].tiles = state.bag.filter(
  (t) => t.kind === "monument" && t.variant < 3,
);
function Preview() {
  const [player, setPlayer] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [bid, setBid] = useState<number | null>(null);
  return (
    <main
      className="table-fit"
      style={{ maxWidth: 950, padding: 16, margin: "0 auto" }}
    >
      <PlayerMat
        state={state}
        player={player}
        onPlayer={setPlayer}
        bidding={
          window.location.search.includes("auction") && player === 0
            ? {
                enabled: true,
                high: 5,
                selected,
                onSelect: setSelected,
                onBid: setBid,
              }
            : undefined
        }
      />
      {bid !== null && <output>已确认出价 {bid}</output>}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
