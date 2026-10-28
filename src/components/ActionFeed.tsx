import type { Move } from "../game/presentation.ts";
import type { State } from "../game/types.ts";
import { TileArt } from "./TileArt.tsx";
import { tileName } from "../game/data.ts";
const isMajorEvent = (move?: Move) =>
  move?.kind === "invoke" ||
  (move?.kind === "draw" && move.tiles.some((tile) => tile.kind === "ra"));
export function ActionFeed({
  moves,
  state,
  stepMode,
  onStepMode,
  waiting,
  onContinue,
  onLog,
  onInspect,
}: {
  moves: Move[];
  state: State;
  stepMode: boolean;
  onStepMode: () => void;
  waiting: boolean;
  onContinue: () => void;
  onLog: () => void;
  onInspect: (move: Move) => void;
}) {
  const latest = moves.at(-1);
  return (
    <section className="action-feed" aria-label="操作播报">
      <header>
        <h3>操作播报</h3>
        <button
          className={stepMode ? "step-mode on" : "step-mode"}
          onClick={onStepMode}
          aria-pressed={stepMode}
        >
          {stepMode ? "逐步观看 ✓" : "逐步观看"}
        </button>
      </header>
      <div
        className={`latest-move ${latest?.kind === "win" ? "won" : ""} ${isMajorEvent(latest) ? "major-event" : ""}`}
        key={latest?.step ?? 0}
        aria-live="polite"
      >
        <span className="move-label">
          {latest
            ? `第 ${latest.step} 步 · ${state.players[latest.actor].human ? "玩家" : "电脑"}`
            : "等待第一步"}
        </span>
        <h4>{latest?.title ?? "太阳已升起"}</h4>
        <p>
          {latest?.detail ?? "留意这里：抽牌、出价、赢得的拍品都会逐步显示。"}
        </p>
        {!!latest?.tiles.length && (
          <div className="move-tiles">
            {latest.tiles.map((t) => (
              <div key={t.id} title={tileName(t)}>
                <TileArt kind={t.kind} variant={t.variant} />
                <span>{tileName(t)}</span>
              </div>
            ))}
          </div>
        )}
        {waiting && (
          <button className="primary compact next-ai" onClick={onContinue}>
            看清了，继续 →
          </button>
        )}
      </div>
      <div className="move-history">
        {moves
          .slice(0, -1)
          .reverse()
          .slice(0, 7)
          .map((m) => (
            <button
              className={`move-row kind-${m.kind} ${isMajorEvent(m) ? "major-event" : ""}`}
              key={m.step}
              onClick={() => onInspect(m)}
              aria-label={`查看第${m.step}步：${m.title}`}
            >
              <span>{String(m.step).padStart(2, "0")}</span>
              <div>
                <b>{m.title}</b>
                {m.kind === "win" && (
                  <small>取得 {m.tiles.length} 块拍品</small>
                )}
                {isMajorEvent(m) && (
                  <small>
                    {m.kind === "invoke"
                      ? "发起拍卖 · 太阳船不前进"
                      : "太阳神 · 推进太阳船"}
                  </small>
                )}
              </div>
            </button>
          ))}
      </div>
      <button className="feed-log" onClick={onLog}>
        查看完整记录与回放 →
      </button>
    </section>
  );
}
