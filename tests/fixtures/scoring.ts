import { newGame, scoreEpoch } from "../../src/game/engine.ts";
import type { Kind, ScoreRow } from "../../src/game/types.ts";
export function settlementFixture(epoch = 3) {
  const state = newGame({
    count: 4,
    humans: 1,
    difficulty: "normal",
    seed: 42,
  });
  state.epoch = epoch;
  state.phase = epoch === 3 ? "over" : "epoch";
  function give(player: number, kind: Kind, variant: number, count: number) {
    const tiles = state.bag
      .filter((t) => t.kind === kind && t.variant === variant)
      .slice(0, count);
    if (tiles.length !== count)
      throw new Error(`Not enough ${kind}/${variant}`);
    state.players[player].tiles.push(...tiles);
    state.bag = state.bag.filter((t) => !tiles.includes(t));
  }
  [3, 3, 1, 1, 1].forEach((n, v) => give(0, "monument", v, n));
  [
    [5, 3],
    [6, 3],
    [7, 1],
    [4, 1],
  ].forEach(([v, n]) => give(1, "monument", v, n));
  [0, 2, 3, 7].forEach((v) => give(2, "monument", v, 1));
  [2, 3, 4, 7].forEach((v) => give(3, "monument", v, 1));
  [1, 1, 2, 3].forEach((n, i) => give(i, "pharaoh", 0, n));
  give(0, "nile", 0, 7);
  give(0, "flood", 0, 2);
  give(2, "nile", 0, 3);
  give(2, "flood", 0, 1);
  give(3, "nile", 0, 6);
  give(3, "flood", 0, 1);
  [0, 1, 2].forEach((v) => give(1, "civilization", v, 1));
  give(2, "civilization", 0, 1);
  const suns = [
    [1, 2, 7],
    [4, 11, 12],
    [3, 5, 8],
    [6, 9, 13],
  ];
  state.center = 10;
  state.players.forEach((p, i) => {
    p.suns = [];
    p.used = suns[i];
    p.score = epoch === 1 ? 10 : [9, 19, 23, 22][i];
  });
  const previous: ScoreRow[] = state.players.map((p) => ({
    name: p.name,
    parts: {},
    delta: 0,
    total: p.score,
  }));
  const rows = scoreEpoch(state);
  state.history = epoch === 3 ? [previous, previous, rows] : [rows];
  state.players.forEach((p, i) => (p.score = rows[i].total));
  return state;
}
