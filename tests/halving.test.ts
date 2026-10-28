import test from "node:test";
import assert from "node:assert/strict";
import { RootHalving } from "../src/game/ai/halving.ts";

test("fixed Sequential Halving covers all arms, handles odd widths and budgets, and retains the best arm", () => {
  for (const count of [2, 3, 5, 7])
    for (const budget of [count, count * 7 + 1, count * 32]) {
      const h = new RootHalving(count, budget, false),
        visits = Array(count).fill(0);
      const means = Array.from({ length: count }, (_, i) => i / count);
      for (let n = 0; n < budget; n++) {
        const arm = h.choose();
        assert.ok(arm >= 0 && arm < count);
        visits[arm]++;
        h.record(means);
      }
      assert.ok(visits.every((n) => n > 0));
      assert.equal(h.best(means), count - 1);
      assert.equal(
        visits.reduce((a, b) => a + b, 0),
        budget,
      );
    }
});

test("Anytime Halving revisits eliminated arms and can recover after rewards change", () => {
  const h = new RootHalving(4, 1000, true),
    means = [1, 0, 0, 0],
    visits = [0, 0, 0, 0];
  for (let n = 0; n < 20; n++) {
    visits[h.choose()]++;
    h.record(means);
  }
  means[3] = 2;
  for (let n = 0; n < 80; n++) {
    visits[h.choose()]++;
    h.record(means);
  }
  assert.ok(visits.every((n) => n > 1));
  assert.equal(h.best(means), 3);
});
