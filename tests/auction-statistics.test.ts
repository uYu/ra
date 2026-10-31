import test from "node:test";
import assert from "node:assert/strict";
import { seedBootstrap } from "../scripts/auction-sampling/statistics.ts";
test("cluster bootstrap keeps constant seed blocks constant and matches a two-block exact interval", () => {
  const constant = seedBootstrap(Array(12).fill(0.625), 1000, 1);
  assert.equal(constant.lower, 0.625);
  assert.equal(constant.upper, 0.625);
  const two = seedBootstrap([0.25, 0.75], 10000, 2);
  assert.equal(two.estimate, 0.5);
  assert.equal(two.lower, 0.25);
  assert.equal(two.upper, 0.75);
  assert.deepEqual(seedBootstrap([0.25, 0.75], 10000, 2), two);
});
test("cluster bootstrap rejects empty, incomplete or invalid block scores", () => {
  for (const scores of [[], [0.5], [0.3, NaN], [0.3, 1.1]])
    assert.throws(() => seedBootstrap(scores));
});
