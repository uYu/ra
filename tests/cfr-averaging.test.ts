import test from "node:test";
import assert from "node:assert/strict";
import { MCCFR, rng } from "../scripts/cfr/core.ts";
import type { Game } from "../scripts/cfr/core.ts";
const game: Game<string> = {
  players: 2,
  initial: () => "",
  actor: (s) => (s.length === 2 ? -2 : s.length === 0 ? 0 : 1),
  actions: () => ["0", "1"],
  next: (s, a) => s + a,
  info: (s) =>
    s.length === 0 ? "opponent" : "updater-private-information-set",
  chance: () => [],
  utility: (s) => [
    0,
    [
      [1, 3],
      [-2, 6],
    ][Number(s[0])][Number(s[1])],
  ],
};
test("importance-corrected regret and strategy averages match an exact counterfactual calculation", () => {
  const random = rng(427);
  let regret = 0,
    average = 0;
  for (let trial = 0; trial < 20000; trial++) {
    const c = new MCCFR(game);
    c.random = random;
    c.row("");
    c.rows.get("opponent")!.regrets = [3, 1];
    c.walk("", 1, 1, 1);
    const row = c.rows.get("updater-private-information-set")!;
    regret += row.regrets[1];
    average += row.average[1];
  }
  assert.ok(Math.abs(regret / 20000 - 1.75) < 0.04);
  // Two hidden histories each contribute ownReach * .5 in full traversal.
  assert.ok(Math.abs(average / 20000 - 1) < 0.04);
});
test("zero-probability opponent branch contributes to own-reach average but not counterfactual regret", () => {
  const c = new MCCFR(game);
  c.random = () => 0.999;
  c.row("");
  c.rows.get("opponent")!.regrets = [1, 0];
  assert.equal(c.walk("", 1, 1, 1), 0);
  const row = c.rows.get("updater-private-information-set")!;
  assert.deepEqual(row.regrets, [0, 0]);
  assert.deepEqual(row.average, [10, 10]);
});
