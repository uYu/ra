import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { observe } from "../src/game/ai.ts";
import { newGame, legalActions } from "../src/game/engine.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const baseline = await createWasmAi(
  await readFile("artifacts/ai-paired-sampling-20261028/baseline.wasm"),
);
const positions = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
) as { state: State }[];
const recorded: State = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
);
function compare(
  actual: ReturnType<typeof ai.search>,
  expected: ReturnType<typeof ai.search>,
) {
  const copy = structuredClone(actual),
    reference = structuredClone(expected);
  for (const r of [copy, reference])
    for (const c of r.candidates)
      for (const k of ["value", "error", "utility", "utilityError"] as const)
        if (c[k] !== undefined) c[k] = Math.round(c[k]! * 1e8) / 1e8;
  assert.deepEqual(copy, reference);
}
test("paired sampling matches TS across counts, phases, horizons and both unchanged reward objectives", () => {
  for (const { state } of positions)
    for (const horizon of ["epoch", "next-epoch", "game"] as const)
      for (const reward of ["relative", "future-rank"] as const) {
        const s = observe(state),
          before = structuredClone(s),
          options = {
            sampling: "paired" as const,
            samples: 4,
            horizon,
            reward,
          };
        const native = ai.search(s, options),
          reference = searchAction(s, options);
        compare(native, reference);
        assert.deepEqual(s, before);
        const n = native.candidates.length;
        assert.equal(native.samples, n === 1 ? 0 : 4 * n);
        assert.equal(
          native.samples,
          (native.trainingSamples ?? 0) + (native.evaluationSamples ?? 0),
        );
        assert.equal(
          native.samples,
          native.candidates.reduce((v, c) => v + c.visits, 0),
        );
        assert.equal(
          native.evaluationSamples,
          (native.evaluationRounds ?? 0) * n,
        );
        assert.ok(
          legalActions(s).some(
            (a) => JSON.stringify(a) === JSON.stringify(native.action),
          ),
        );
      }
});
test("paired sampling can evaluate without training and covers complete paired rounds", () => {
  for (const samples of [1, 2, 3, 7]) {
    const s = observe(recorded),
      options = {
        sampling: "paired" as const,
        samples,
        horizon: "next-epoch" as const,
      };
    const r = ai.search(s, options);
    compare(r, searchAction(s, options));
    assert.equal(r.samples, samples * 3);
    assert.equal(r.evaluationRounds, Math.max(1, Math.floor(samples / 4)));
    assert.ok(
      r.candidates.every((c) => c.evaluationVisits === r.evaluationRounds),
    );
    if (samples === 1) assert.equal(r.trainingSamples, 0);
  }
});
test("paired evaluation masks hidden scores, bag order and seed and preserves default search", () => {
  for (const { state } of positions) {
    const s = structuredClone(state),
      options = {
        sampling: "paired" as const,
        samples: 8,
        horizon: "next-epoch" as const,
      };
    const expected = ai.search(s, options),
      original = baseline.search(s, { samples: 8 });
    s.bag.reverse();
    s.config.seed ^= 0x123456;
    s.players.forEach((p, i) => {
      p.score = i === s.current ? 999 : 700 + i;
    });
    assert.deepEqual(ai.search(s, options), expected);
    compare(searchAction(observe(s), options), expected);
    assert.deepEqual(ai.search(s, { samples: 8 }), original);
  }
});
test("forced actions need no sampling and invalid sampling/variant combinations are rejected", () => {
  const s = newGame({ count: 2, humans: 0, difficulty: "hard", seed: 7 });
  s.phase = "epoch";
  compare(
    ai.search(s, { sampling: "paired" }),
    searchAction(observe(s), { sampling: "paired" }),
  );
  for (const run of [
    (options: any) => ai.search(recorded, options),
    (options: any) => searchAction(observe(recorded), options),
  ]) {
    assert.throws(() => run({ sampling: "unknown" }), /采样/);
    for (const variant of ["sh", "dpw"])
      assert.throws(() => run({ sampling: "paired", variant }), /UCT/);
  }
});
