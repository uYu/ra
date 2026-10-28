import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as frozenAi } from "../src/game/ai/wasm-frozen-uct4.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { candidateActions } from "../src/game/ai/policy.ts";
import {
  POLICY_INPUTS,
  policyStateFeatures,
  policyActionFeatures,
  rolloutAction,
  rolloutScores,
  validateRolloutModel,
  type RolloutModel,
} from "../src/game/ai/rollout.ts";
import type { State } from "../src/game/types.ts";
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm")),
  old = await frozenAi(await readFile("artifacts/frozen-uct4/ra-ai.wasm"));
const model: RolloutModel = {
  version: 1,
  inputs: POLICY_INPUTS,
  hidden: 3,
  weights: Array.from(
    { length: 3 * (POLICY_INPUTS + 2) + 1 },
    (_, i) => Math.sin(i * 17) * 0.2,
  ),
};
const trained: RolloutModel = JSON.parse(
  await readFile("artifacts/ai-rollout-model.json", "utf8"),
);
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    seed: 820001 + count,
    humans: 0,
    difficulty: "normal",
  });
  const seen = new Set();
  while (s.phase !== "over") {
    if (!seen.has(s.phase) || s.steps % 19 === 0) {
      positions.push(s);
      seen.add(s.phase);
    }
    s = advance(s, ai.policy(s));
  }
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("rollout feature vectors, candidate logits and selected actions match native at all phases", () => {
  for (const active of [model, trained])
    for (const s of positions) {
      validateRolloutModel(active);
      const native = ai.rollout(s, active),
        expected = rolloutScores(s, active);
      assert.equal(native.stateFeatures.length, 263);
      assert.deepEqual(native.stateFeatures, policyStateFeatures(s));
      assert.equal(native.candidates.length, expected.length);
      native.candidates.forEach((c, i) => {
        assert.deepEqual(c.action, expected[i].action);
        assert.equal(c.features.length, 24);
        assert.deepEqual(c.features, policyActionFeatures(s, c.action));
        close(c.logit, expected[i].logit);
      });
      assert.deepEqual(native.action, rolloutAction(s, active));
    }
});
test("learned rollout search matches TS and ignores real hidden information without mutating source", () => {
  for (const active of [model, trained])
    for (const count of [2, 3, 4, 5])
      for (const epoch of [1, 2, 3]) {
        const s = positions.find(
          (s) =>
            s.config.count === count &&
            s.epoch === epoch &&
            candidateActions(s).length > 1,
        );
        if (!s) continue;
        const before = structuredClone(s),
          actual = ai.search(s, { samples: 2, rolloutModel: active }),
          expected = searchAction(observe(s), {
            samples: 2,
            rolloutModel: active,
          });
        assert.deepEqual(actual.action, expected.action);
        for (const key of [
          "samples",
          "transitions",
          "nodes",
          "depth",
          "completed",
          "truncated",
        ] as const)
          assert.equal(actual[key], expected[key]);
        actual.candidates.forEach((c, i) => {
          assert.deepEqual(c.action, expected.candidates[i].action);
          assert.equal(c.visits, expected.candidates[i].visits);
          close(c.value, expected.candidates[i].value);
        });
        const hidden = structuredClone(s);
        hidden.bag.reverse();
        hidden.config.seed = 99873;
        hidden.players.forEach((p, i) => (p.score = 900 + i));
        assert.deepEqual(
          ai.search(hidden, { samples: 2, rolloutModel: active }),
          actual,
        );
        assert.deepEqual(s, before);
      }
});
test("no-model searches reproduce frozen ABI4 exactly, including after experimental model use", () => {
  for (const count of [2, 3, 4, 5])
    for (const s of positions
      .filter((s) => s.config.count === count && candidateActions(s).length > 1)
      .slice(0, 4)) {
      ai.search(s, { samples: 2, rolloutModel: model });
      assert.deepEqual(
        ai.search(s, { samples: 4 }),
        old.search(s, { samples: 4 }),
      );
    }
});
test("rollout model validation, soft time budget and simultaneous value-model payload work", async () => {
  for (const m of [
    { ...model, inputs: 286 },
    { ...model, hidden: 17 },
    { ...model, weights: [NaN] },
    { ...model, weights: model.weights.map((v, i) => (i === 0 ? 1e20 : v)) },
  ]) {
    assert.throws(() => validateRolloutModel(m));
    assert.throws(() => ai.search(positions[0], { rolloutModel: m }));
    assert.throws(() =>
      searchAction(observe(positions[0]), { rolloutModel: m }),
    );
  }
  const valueModel = {
    version: 1 as const,
    inputs: 91,
    hidden: 48,
    weights: Array(48 * (91 + 2) + 1).fill(0),
  };
  const largest: RolloutModel = {
    version: 1,
    inputs: POLICY_INPUTS,
    hidden: 16,
    weights: Array(16 * (POLICY_INPUTS + 2) + 1).fill(0),
  };
  const r = ai.search(positions[0], {
    timeMs: 2,
    rolloutModel: largest,
    valueModel,
  });
  assert.ok(
    r.candidates.every((c) => Number.isFinite(c.value) && c.visits > 0),
  );
});

test("rollout inputs preserve player-rotation symmetry and exclude hidden totals, bag order and seed", () => {
  for (const s of positions) {
    const n = s.players.length,
      rotate = (i: number) => (i < 0 ? i : (i + n - 1) % n);
    const changed = structuredClone(s);
    changed.players = [...changed.players.slice(1), changed.players[0]];
    changed.current = rotate(s.current);
    changed.next = rotate(s.next);
    changed.bag.reverse();
    changed.config.seed = 999;
    changed.players.forEach((p, i) => {
      p.score = 999 + i;
      p.name = "anonymous";
    });
    if (changed.auction) {
      const a = changed.auction;
      a.caller = rotate(a.caller);
      a.winner = rotate(a.winner);
      a.order = a.order.map(rotate);
      a.bids = a.bids.map((b) => ({ ...b, player: rotate(b.player) }));
    }
    const before = policyStateFeatures(s),
      after = policyStateFeatures(changed);
    before.forEach((v, i) => close(v, after[i]));
    const a = rolloutScores(s, trained),
      b = rolloutScores(changed, trained);
    a.forEach((row, i) => {
      assert.deepEqual(row.action, b[i].action);
      close(row.logit, b[i].logit);
    });
  }
});
