import test from "node:test";
import assert from "node:assert/strict";
import { newGame } from "../src/game/engine.ts";
import { canInspectUsedSuns } from "../src/game/visibility.ts";

test("a solo human can inspect their own used disks even during an AI turn, but never opponents'", () => {
  const state = newGame({
    count: 4,
    humans: 1,
    difficulty: "normal",
    seed: 42,
  });
  state.current = 2;
  assert.equal(canInspectUsedSuns(state, 0), true);
  for (const owner of [1, 2, 3])
    assert.equal(canInspectUsedSuns(state, owner), false);
});

test("shared-screen humans can only inspect the current human's disks", () => {
  const state = newGame({
    count: 4,
    humans: 2,
    difficulty: "normal",
    seed: 42,
  });
  state.current = 1;
  assert.equal(canInspectUsedSuns(state, 0), false);
  assert.equal(canInspectUsedSuns(state, 1), true);
  assert.equal(canInspectUsedSuns(state, 2), false);
  state.current = 2;
  assert.equal(canInspectUsedSuns(state, 1), false);
});

test("spectators cannot inspect hidden disks until the game is over", () => {
  const state = newGame({
    count: 3,
    humans: 0,
    difficulty: "normal",
    seed: 42,
  });
  for (const phase of ["turn", "epoch", "over"] as const) {
    state.phase = phase;
    for (let owner = 0; owner < state.players.length; owner++)
      assert.equal(canInspectUsedSuns(state, owner), phase === "over");
  }
});
