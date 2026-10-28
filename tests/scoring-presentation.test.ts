import test from "node:test";
import assert from "node:assert/strict";
import { explainScore } from "../src/game/scoring-presentation.ts";
import { settlementFixture } from "./fixtures/scoring.ts";
import { scoreEpoch } from "../src/game/engine.ts";

test("board regions sum exactly to the recorded settlement, splitting river into Nile and flood", () => {
  for (const epoch of [1, 3]) {
    const state = settlementFixture(epoch);
    for (let player = 0; player < 4; player++) {
      const detail = explainScore(state, player);
      const sum = Object.values(detail.groups).reduce(
        (n, item) => n + (item!.points ?? 0),
        detail.sun.points ?? 0,
      );
      const row = state.history.at(-1)![player];
      assert.equal(sum, row.delta);
      assert.equal(
        detail.groups.nile!.points! + detail.groups.flood!.points!,
        row.parts.河流,
      );
    }
  }
});
test("the user's example explains ancient sets, activated rivers and all three penalties", () => {
  const state = settlementFixture();
  const detail = explainScore(state, 0);
  assert.deepEqual(
    state.history.at(-1)!.map((row) => row.total),
    [21, 36, 31, 38],
  );
  assert.equal(detail.groups.monument!.points, 15);
  assert.ok(detail.groups.monument!.reason.includes("5 种古迹得 5 分"));
  assert.ok(detail.groups.monument!.reason.includes("阶梯金字塔 3 块 +5 分"));
  assert.equal(detail.groups.nile!.points, 7);
  assert.equal(detail.groups.flood!.points, 2);
  assert.equal(detail.groups.pharaoh!.points, -2);
  assert.ok(detail.groups.pharaoh!.reason.includes("全场最少"));
  assert.equal(detail.groups.civilization!.points, -5);
  assert.equal(detail.sun.points, -5);
  assert.ok(detail.sun.reason.includes("1 + 2 + 7 = 10"));
  assert.ok(detail.sun.reason.includes("全场总和最低"));
});
test("before the last epoch, monuments and suns are deferred and hidden disk values stay hidden", () => {
  const detail = explainScore(settlementFixture(1), 1);
  assert.equal(detail.groups.monument!.points, null);
  assert.equal(detail.sun.points, null);
  assert.equal(detail.sun.reason.includes("11"), false);
});
test("without flood the Nile scores zero and equal pharaoh counts earn no extreme bonus", () => {
  const state = settlementFixture();
  state.players.forEach(
    (p) =>
      (p.tiles = p.tiles.filter(
        (t) => t.kind !== "flood" && t.kind !== "pharaoh",
      )),
  );
  state.history[state.history.length - 1] = scoreEpoch(state);
  const detail = explainScore(state, 0);
  assert.equal(detail.groups.nile!.points, 0);
  assert.ok(detail.groups.nile!.reason.includes("无法得分"));
  assert.equal(detail.groups.pharaoh!.points, 0);
  assert.ok(detail.groups.pharaoh!.reason.includes("全场都是"));
});
