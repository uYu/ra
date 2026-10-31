import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { hardSearchSampling } from "../src/game/ai.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(
  await readFile(new URL("../src/game/ai/ra-ai.wasm", import.meta.url)),
);
const corpus = JSON.parse(
  await readFile(
    new URL("../artifacts/ai-perf-20261028/positions.json", import.meta.url),
    "utf8",
  ),
) as { state: State }[];
test("production auction sampling matches the independent TS implementation across counts and epochs", () => {
  assert.equal(hardSearchSampling, "auction");
  for (const { state } of corpus) {
    const actual = ai.search(state, {
      samples: 2,
      sampling: "auction",
      horizon: "next-epoch",
    });
    if (state.phase !== "auction") {
      assert.deepEqual(
        actual,
        ai.search(state, { samples: 2, horizon: "next-epoch" }),
      );
      continue;
    }
    for (const horizon of ["epoch", "next-epoch", "game"] as const) {
      const a = ai.search(state, { samples: 2, sampling: "auction", horizon });
      const b = searchAction(state, {
        samples: 2,
        sampling: "auction",
        horizon,
      });
      assert.deepEqual(a.action, b.action);
      for (const key of [
        "samples",
        "transitions",
        "completed",
        "truncated",
        "epochAdvances",
        "nodes",
        "depth",
        "scenarios",
        "outcomeReuses",
        "maxOutcomeBranches",
      ] as const)
        assert.equal(a[key], b[key], key);
      assert.equal(a.candidates.length, b.candidates.length);
      a.candidates.forEach((c, j) => {
        assert.deepEqual(c.action, b.candidates[j].action);
        assert.equal(c.visits, b.candidates[j].visits);
        assert.ok(Math.abs(c.value - b.candidates[j].value) < 1e-7);
        assert.ok(Math.abs(c.error - b.candidates[j].error) < 1e-7);
      });
    }
    const hidden = structuredClone(state);
    hidden.bag.reverse();
    hidden.config.seed += 100;
    hidden.players.forEach((p, i) => (p.score += 53 + i * 97));
    assert.deepEqual(
      ai.search(hidden, {
        samples: 2,
        sampling: "auction",
        horizon: "next-epoch",
      }),
      actual,
    );
  }
});
test("both production backends reject incompatible auction options", () => {
  const state = corpus[0].state;
  for (const search of [ai.search.bind(ai), searchAction]) {
    assert.throws(() => search(state, { sampling: "auction", variant: "sh" }));
    assert.throws(() =>
      search(state, { sampling: "auction", reward: "future-rank" }),
    );
  }
});
