import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as frozenAi } from "../src/game/ai/wasm-frozen-uct3.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { searchAction } from "../src/game/ai/search.ts";
import {
  VALUE_INPUTS,
  valueFeatures,
  learnedFuture,
  validateValueModel,
  type ValueModel,
} from "../src/game/ai/value.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(
  await readFile(new URL("../src/game/ai/ra-ai.wasm", import.meta.url)),
);
const old = await frozenAi(
  await readFile(
    new URL("../artifacts/frozen-uct3/ra-ai.wasm", import.meta.url),
  ),
);
const model: ValueModel = {
  version: 1,
  inputs: VALUE_INPUTS,
  hidden: 3,
  weights: Array.from(
    { length: 3 * (VALUE_INPUTS + 2) + 1 },
    (_, i) => Math.sin(i * 13) * 0.2,
  ),
};
const trained: ValueModel = JSON.parse(
  await readFile(
    new URL("../artifacts/ai-value-model.json", import.meta.url),
    "utf8",
  ),
);
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    seed: 87031 + count,
    humans: 0,
    difficulty: "normal",
  });
  while (s.phase !== "over") {
    if (s.phase === "epoch") positions.push(s);
    s = advance(s, ai.policy(s));
  }
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("learned value native features and inference match TS at scored epoch boundaries", () => {
  for (const active of [model, trained])
    for (const s of positions) {
      validateValueModel(active);
      const native = ai.value(s, active),
        expected = learnedFuture(s, active);
      native.forEach((row, i) => {
        assert.equal(row.features.length, VALUE_INPUTS);
        assert.deepEqual(row.features, valueFeatures(s, i));
        close(row.prediction, expected[i]);
      });
    }
});
test("value features exclude hidden scores, bag order, seat names and seed; permute with players", () => {
  for (const s of positions) {
    const changed = structuredClone(s);
    changed.bag.reverse();
    changed.config.seed = 9999;
    changed.players.forEach((p, i) => {
      p.score = -999 * i;
      p.name = "hidden";
    });
    assert.deepEqual(learnedFuture(s, model), learnedFuture(changed, model));
    const rotated = { ...s, players: [...s.players.slice(1), s.players[0]] };
    const expected = learnedFuture(s, model),
      actual = learnedFuture(rotated, model);
    actual.forEach((x, i) => close(x, expected[(i + 1) % s.players.length]));
  }
});
test("learned search matches TS, leaves source untouched, and cannot alter a subsequent default search", () => {
  for (const epoch of positions) {
    const s = advance(epoch, { type: "next" }),
      before = structuredClone(s);
    const expected = searchAction(observe(s), {
        samples: 4,
        valueModel: model,
      }),
      actual = ai.search(s, { samples: 4, valueModel: model });
    assert.deepEqual(actual.action, expected.action);
    assert.equal(actual.samples, expected.samples);
    actual.candidates.forEach((c, i) => {
      assert.deepEqual(c.action, expected.candidates[i].action);
      assert.equal(c.visits, expected.candidates[i].visits);
      close(c.value, expected.candidates[i].value);
    });
    assert.deepEqual(s, before);
    const hidden = structuredClone(s);
    hidden.bag.reverse();
    hidden.config.seed = -6789;
    hidden.players.forEach((p, i) => {
      p.score = 900 + i;
    });
    assert.deepEqual(
      ai.search(hidden, { samples: 4, valueModel: model }),
      actual,
    );
    const baseline = old.search(s, { samples: 4 });
    const now = ai.search(s, { samples: 4 });
    assert.deepEqual(now, baseline);
  }
});
test("invalid models are rejected before native execution", () => {
  for (const m of [
    { ...model, inputs: 90 },
    { ...model, hidden: 0 },
    { ...model, weights: [NaN] },
    { ...model, weights: model.weights.slice(1) },
  ]) {
    assert.throws(() => validateValueModel(m));
    assert.throws(() => ai.search(positions[0], { valueModel: m }));
    assert.throws(() => searchAction(observe(positions[0]), { valueModel: m }));
  }
});
