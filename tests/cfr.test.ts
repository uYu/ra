import test from "node:test";
import assert from "node:assert/strict";
import {
  MCCFR,
  evaluate,
  bestResponse,
  rng,
  pick,
} from "../scripts/cfr/core.ts";
import { kuhn, miniRa } from "../scripts/cfr/games.ts";
const uniform = (_s: unknown, a: string[]) => a.map(() => 1 / a.length);
test("Kuhn information-set best response matches analytical equilibrium, without hidden-card leakage", () => {
  const equilibrium = (s: { cards: number[]; history: string }) => {
    const actor = kuhn.actor(s),
      card = s.cards[actor];
    let bet: number;
    if (actor === 0)
      bet = s.history === "" ? [1 / 3, 0, 1][card] : [0, 2 / 3, 1][card];
    else bet = s.history === "p" ? [1 / 3, 0, 1][card] : [0, 1 / 3, 1][card];
    return [1 - bet, bet];
  };
  const u = evaluate(kuhn, equilibrium);
  assert.ok(Math.abs(u[0] + 1 / 18) < 1e-12);
  const b0 = bestResponse(kuhn, equilibrium, 0).value,
    b1 = bestResponse(kuhn, equilibrium, 1).value;
  assert.ok(Math.abs(b0 + b1) < 1e-12);
  assert.ok(
    bestResponse(kuhn, uniform, 0).value +
      bestResponse(kuhn, uniform, 1).value >
      0.5,
  );
});
test("external-sampling CFR learns Kuhn and is reproducible", () => {
  const a = new MCCFR(kuhn, 17),
    b = new MCCFR(kuhn, 17);
  a.train(12000);
  b.train(12000);
  assert.deepEqual([...a.rows], [...b.rows]);
  const nashConv =
    bestResponse(kuhn, a.policy, 0).value +
    bestResponse(kuhn, a.policy, 1).value;
  assert.ok(nashConv < 0.08, `NashConv ${nashConv}`);
  assert.ok(Math.abs(evaluate(kuhn, a.policy)[0] + 1 / 18) < 0.05);
  for (const row of a.rows.values())
    assert.ok([...row.regrets, ...row.average].every(Number.isFinite));
});
test("mini Ra disk conservation, probability, turn legality and finite games for 2–5 players", () => {
  const random = rng(22);
  for (let count = 2; count <= 5; count++)
    for (let trial = 0; trial < 100; trial++) {
      const g = miniRa(count);
      let s = g.initial(),
        steps = 0;
      const original = [s.center, ...s.suns.flat()].sort((a, b) => a - b);
      while (g.actor(s) !== -2) {
        assert.ok(++steps < 100);
        const chance = g.actor(s) === -1,
          actions = chance ? g.chance(s).map((x) => x.action) : g.actions(s);
        assert.ok(actions.length > 0);
        const ps = chance
          ? g.chance(s).map((x) => x.probability)
          : uniform(s, actions);
        assert.ok(Math.abs(ps.reduce((a, b) => a + b, 0) - 1) < 1e-12);
        s = g.next(s, actions[pick(ps, random)]);
        assert.deepEqual(
          [s.center, ...s.suns.flat(), ...s.used.flat()].sort((a, b) => a - b),
          original,
        );
      }
      assert.ok(Math.abs(g.utility(s).reduce((a, b) => a + b, 0)) < 1e-10);
    }
});
