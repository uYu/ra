import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScoreBoard } from "../../src/components/ScoreBoard.tsx";
import { Dialog } from "../../src/components/Dialog.tsx";
import { settlementFixture } from "../../tests/fixtures/scoring.ts";
import "../../src/style.css";
import "../../src/tabletop.css";
const state = settlementFixture(
  window.location.search.includes("epoch") ? 1 : 3,
);
function Preview() {
  const [player, setPlayer] = useState(0);
  if (window.location.search.includes("plain"))
    return (
      <main style={{ maxWidth: 1120, padding: 16, margin: "0 auto" }}>
        <ScoreBoard state={state} player={player} onPlayer={setPlayer} />
      </main>
    );
  return (
    <Dialog
      title={state.epoch === 3 ? "第三纪元 · 版图结算" : "第一纪元 · 版图结算"}
      onClose={() => {}}
      wide
      className="result-dialog"
    >
      <ScoreBoard state={state} player={player} onPlayer={setPlayer} />
      <div className="result-actions">
        <button className="secondary">查看牌桌</button>
        <button className="primary">再启王朝</button>
      </div>
    </Dialog>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
