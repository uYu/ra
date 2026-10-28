import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, Check } from "lucide-react";
import { Glyph } from "../../src/components/Art.tsx";
import { PublicBoard } from "../../src/components/PublicBoard.tsx";
import { newGame } from "../../src/game/engine.ts";
import "../../src/style.css";
import "../../src/tabletop.css";
const state = newGame({ count: 4, humans: 1, difficulty: "normal", seed: 42 });
state.current = 0;
state.players[0].tiles = [state.bag.find(tile => tile.kind === "god")!];
state.market = [
  state.bag.find((t) => t.kind === "civilization")!,
  state.bag.find((t) => t.kind === "monument")!,
];
function Preview() {
  const [mode, setMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <main
      className="table-fit"
      style={{ maxWidth: 1100, padding: 16, margin: "0 auto" }}
    >
      <PublicBoard
        state={state}
        moving={false}
        canExchange={mode}
        selected={selected}
        onSelect={(id) => setSelected([id])}
      />
      <section
        className={`action-panel phase-turn ${mode ? "exchanging" : ""}`}
        style={{ marginTop: 12 }}
      >
        <div className="action-heading">
          <div className="status-icon">
            <Glyph kind="ra" />
          </div>
          <div>
            <h2>你的回合</h2>
            <p>抽取未知，或在恰好的时刻呼唤太阳神。</p>
          </div>
          <span className="your-turn">轮到你了</span>
        </div>
        <div className="phase-actions">
          <div className="action-buttons">
            <button className="primary" disabled={mode}>
              <span className="action-button-copy">
                <b>抽取一块牌</b>
                <small>探索未知</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button className="secondary invoke" disabled={mode}>
              <Glyph kind="ra" />
              <span className="action-button-copy">
                <b>呼唤 RA</b>
                <small>发起拍卖</small>
              </span>
            </button>
            <button
              className={`secondary god-action ${mode ? "chosen" : ""}`}
              onClick={() => {
                setMode(!mode);
                setSelected([]);
              }}
            >
              <Glyph kind="god" />
              <span className="action-button-copy">
                <b>{mode ? "取消交换" : "使用神祇"}</b>
                <small>换取指定拍品</small>
              </span>
            </button>
          </div>
          {mode ? (
            <div className="selection-action">
              <span>选择一块非神祇拍品，以一块神牌换取。</span>
              <button className="primary compact" disabled={!selected.length}>
                <Check size={16} />
                确认交换
              </button>
            </div>
          ) : (
            <div className="turn-action-hint">
              持有神祇：点击“使用神祇”后，选择一块非神祇拍品交换。
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
