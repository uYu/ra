import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { sampleScenario } from "../src/game/ai/sampling.ts";
import { observe } from "../src/game/ai.ts";
import { simulate, legalActions } from "../src/game/engine.ts";
import type { Action } from "../src/game/types.ts";
const probe = await createWasmAi(
  await readFile(
    process.argv[2] ?? "artifacts/ai-search-frozen-policy-20261028/probe.wasm",
  ),
);
const native = (probe as any).native;
const s = observe(
  JSON.parse(
    await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
  ),
);
const bag = [...s.bag].sort((a, b) => a.id - b.id),
  roots = legalActions(s);
let trajectories = 0,
  actionsChecked = 0;
for (const innerC of [1.4, 0.35])
  for (const mode of [0, 1, 2]) {
    native.configure_probe(32768, 0, innerC, 1.4, 64);
    native.configure_evaluation(2, 100000, mode);
    probe.search(s, { samples: 128, horizon: "next-epoch" });
    const data = new Float64Array(
      native.memory.buffer,
      native.evaluation_trace_ptr(),
      32768,
    );
    let cursor = 1;
    for (let i = 0; i < data[0]; i++) {
      const root = data[cursor++],
        scene = data[cursor++],
        count = data[cursor++];
      const world = sampleScenario(s, 100000 + scene, bag);
      let next = {
        ...structuredClone(s),
        bag: world.bag,
        players: s.players.map((p) => ({ ...p, score: 100 })),
      };
      for (let step = 0; step < count; step++) {
        const actor = data[cursor++],
          type = data[cursor++],
          arg = data[cursor++],
          second = data[cursor++],
          n = data[cursor++];
        const a: Action =
          type === 0
            ? { type: "draw" }
            : type === 1
              ? { type: "invoke" }
              : type === 2
                ? { type: "bid", sun: arg < 0 ? null : arg }
                : type === 3
                  ? { type: "god", tileId: arg }
                  : type === 4
                    ? { type: "finish" }
                    : type === 5
                      ? {
                          type: "discard",
                          ids: n === 1 ? [arg] : [arg, second],
                        }
                      : { type: "next" };
        if (step === 0) assert.deepEqual(a, roots[root]);
        assert.equal(next.current, actor);
        assert.ok(
          legalActions(next).some(
            (x) => JSON.stringify(x) === JSON.stringify(a),
          ),
        );
        next = simulate(next, a);
        actionsChecked++;
      }
      assert.equal(next.phase, "over");
      assert.deepEqual(
        next.players.map((p) => p.score - 100),
        Array.from({ length: s.config.count }, () => data[cursor++]),
      );
      trajectories++;
    }
  }
const result = {
  trajectories,
  actionsChecked,
  independentRules:
    "TypeScript simulate, each action checked legal and actor checked, final score vector matched",
  trainingIterations: 32768,
  evaluationOffset: 100000,
  innerC: [1.4, 0.35],
  modes: ["greedy-utility", "greedy-visits", "original-policy"],
  passed: true,
};
await writeFile(
  "artifacts/ai-search-frozen-policy-20261028/reference-checks.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
