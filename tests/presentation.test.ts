import test from "node:test";
import assert from "node:assert/strict";
import { advance, newGame } from "../src/game/engine.ts";
import { describeMove, recentMoves } from "../src/game/presentation.ts";
import { chooseAction, observe } from "../src/game/ai.ts";
import type { Action, Save } from "../src/game/types.ts";
const setup = () =>
  newGame({ count: 3, humans: 1, difficulty: "normal", seed: 100 });
test("draw presentation names the acting player and the revealed tile", () => {
  const before = setup(),
    after = advance(before, { type: "draw" }),
    m = describeMove(before, { type: "draw" }, after);
  assert.equal(m.actor, before.current);
  assert.equal(m.tiles[0].id, after.lastTile!.id);
  assert.ok(m.title.includes(before.players[before.current].name));
  assert.equal(m.step, 1);
});
test("last bidder passing still announces the previous bidder as winner and shows the entire lot", () => {
  let s = setup();
  s = advance(s, { type: "draw" });
  s = advance(s, { type: "invoke" });
  const winner = s.current,
    sun = s.players[winner].suns[0],
    lot = [...s.market],
    center = s.center;
  s = advance(s, { type: "bid", sun });
  s = advance(s, { type: "bid", sun: null });
  const a: Action = { type: "bid", sun: null };
  const after = advance(s, a),
    move = describeMove(s, a, after);
  assert.equal(move.kind, "win");
  assert.equal(move.actor, s.current);
  assert.equal(move.winner, winner);
  assert.deepEqual(move.tiles, lot);
  assert.ok(move.title.includes(s.players[winner].name));
  assert.ok(move.detail.includes(`换回已使用圆盘 ${center}`));
});
test("recent move reconstruction is bounded, chronological, and does not mutate the save", () => {
  let state = setup();
  const save: Save = { version: 1, config: state.config, actions: [] };
  for (let i = 0; i < 30; i++) {
    const a = chooseAction(observe(state));
    save.actions.push(a);
    state = advance(state, a);
  }
  const copy = structuredClone(save);
  const moves = recentMoves(save, 20, 5);
  assert.equal(moves.length, 5);
  assert.deepEqual(
    moves.map((m) => m.step),
    [16, 17, 18, 19, 20],
  );
  assert.deepEqual(save, copy);
});
