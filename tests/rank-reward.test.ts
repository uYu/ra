import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as createFrozen } from "../src/game/ai/wasm-frozen-uct5.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { candidateActions, policyAction } from "../src/game/ai/policy.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const frozen = await createFrozen(
  await readFile("artifacts/frozen-uct5/ra-ai.wasm"),
);
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    seed: 830000 + count,
    humans: 0,
    difficulty: "hard",
  });
  const seen = new Set<string>();
  while (s.phase !== "over") {
    const key = `${s.epoch}/${s.phase}`;
    if (!seen.has(key) && candidateActions(s).length > 1) {
      positions.push(s);
      seen.add(key);
    }
    s = advance(s, policyAction(s));
  }
}
test("future-rank native and TS agree across player counts, epochs and tree variants", () => {
  for (const s of positions)
    for (const variant of ["uct", "sh", "dpw"] as const) {
      const options = { samples: 4, variant, reward: "future-rank" as const };
      const actual = ai.search(s, options),
        expected = searchAction(observe(s), options);
      assert.deepEqual(actual.action, expected.action);
      for (const key of [
        "samples",
        "transitions",
        "completed",
        "truncated",
        "nodes",
        "depth",
        "scenarios",
        "outcomeReuses",
        "maxOutcomeBranches",
      ] as const)
        assert.equal(actual[key], expected[key]);
      actual.candidates.forEach((c, i) => {
        const e = expected.candidates[i];
        assert.deepEqual(c.action, e.action);
        assert.equal(c.visits, e.visits);
        assert.ok(Math.abs(c.value - e.value) < 1e-10);
        assert.ok(Math.abs(c.error - e.error) < 1e-10);
        assert.ok(c.value >= 0 && c.value <= 1);
      });
    }
});
test("rank searches ignore hidden totals, bag order, game seed and history and preserve source", () => {
  for (const s of positions) {
    const before = structuredClone(s);
    const options = {
      samples: 3,
      variant: "sh" as const,
      reward: "future-rank" as const,
    };
    const actual = ai.search(s, options);
    const hidden = structuredClone(s);
    hidden.players.forEach((p, i) => (p.score = 10000 - i * 700));
    hidden.bag.reverse();
    hidden.config.seed = 555;
    hidden.history = [];
    assert.deepEqual(ai.search(hidden, options), actual);
    assert.deepEqual(
      searchAction(observe(hidden), options),
      searchAction(observe(s), options),
    );
    assert.deepEqual(s, before);
  }
});
test("default and explicit relative rewards reproduce frozen ABI5, including after rank calls", () => {
  for (const s of positions)
    for (const variant of ["uct", "sh", "dpw"] as const) {
      ai.search(s, { samples: 2, variant, reward: "future-rank" });
      const options = { samples: 4, variant };
      const expected = frozen.search(s, options);
      assert.deepEqual(ai.search(s, options), expected);
      assert.deepEqual(
        ai.search(s, { ...options, reward: "relative" }),
        expected,
      );
    }
});
test("invalid reward options fail before any simulation in both implementations", () => {
  const bad = { reward: "rank-of-private-score" } as never;
  assert.throws(() => ai.search(positions[0], bad), /未知搜索奖励/);
  assert.throws(() => searchAction(observe(positions[0]), bad), /未知搜索奖励/);
});
