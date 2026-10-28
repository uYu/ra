import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import {
  newGame,
  advance,
  simulate,
  legalActions,
  scoreEpoch,
} from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import {
  policyAction,
  candidateActions,
  auctionPlan,
} from "../src/game/ai/policy.ts";
import { positionValues, futureValues } from "../src/game/ai/evaluation.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { random } from "../src/game/data.ts";
import type { State } from "../src/game/types.ts";

const ai = await createWasmAi(
  await readFile(new URL("../src/game/ai/ra-ai.wasm", import.meta.url)),
);
function core(s: State) {
  const { history: _history, log: _log, ...result } = s;
  return result;
}
function close(a: number[], b: number[], label = "values") {
  assert.equal(a.length, b.length);
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < 1e-9, `${label}[${i}] ${v} != ${b[i]}`),
  );
}
const positions: State[] = [];
test("Wasm rules, legal actions, scoring and estimates match TS through 12 complete games", () => {
  let transitions = 0,
    disasters = 0,
    auctions = 0;
  for (const count of [2, 3, 4, 5])
    for (const seed of [31, 53, 79]) {
      let s = newGame({ count, humans: 0, difficulty: "normal", seed });
      const rng = random(seed * 23 + count);
      while (s.phase !== "over" && s.steps < 1500) {
        const actions = legalActions(s);
        assert.deepEqual(
          ai.legal(s),
          actions,
          `legal ${count}/${seed}/${s.steps}`,
        );
        const v = ai.evaluate(s);
        close(v.position, positionValues(s), "position");
        close(v.future, futureValues(s), "future");
        assert.deepEqual(
          v.scores,
          scoreEpoch(s).map((r) => r.delta),
        );
        if (s.phase === "disaster") disasters++;
        if (s.phase === "auction") auctions++;
        if (
          s.steps % 37 === 0 &&
          candidateActions(s).length > 1 &&
          positions.filter((p) => p.config.count === count).length < 6
        )
          positions.push(observe(s));
        // Mix policy play with arbitrary legal moves, including poor bids,
        // disaster pairs and god continuations, to exercise more than one policy.
        const action =
          rng() < 0.3
            ? actions[Math.floor(rng() * actions.length)]
            : policyAction(s);
        if (
          s.phase === "disaster" ||
          s.phase === "epoch" ||
          s.steps % 19 === 0
        ) {
          for (const action of actions)
            assert.deepEqual(
              core(ai.simulate(s, action)),
              core(simulate(s, action)),
            );
        }
        const actual = ai.simulate(s, action),
          expected = simulate(s, action);
        assert.deepEqual(
          core(actual),
          core(expected),
          `transition ${count}/${seed}/${s.steps}`,
        );
        transitions++;
        s = expected;
      }
      assert.equal(s.phase, "over");
    }
  assert.ok(transitions > 1000);
  assert.ok(disasters > 10);
  assert.ok(auctions > 100);
});

test("native policy and complete auction continuations agree with the reference", () => {
  for (const s of positions) {
    assert.deepEqual(ai.candidates(s), candidateActions(s));
    assert.deepEqual(ai.policy(s), policyAction(s));
    if (s.phase === "auction") {
      const native = ai.auction(s),
        reference = auctionPlan(s);
      assert.deepEqual(native.actions, reference.actions);
      assert.equal(native.winner, reference.winner);
      assert.equal(native.sun, reference.sun);
      close(native.values, reference.values);
    }
  }
});

test("native MCTS preserves seeded scenes, tree counts, visits and candidate values", () => {
  assert.equal(positions.length, 24);
  for (const s of positions) {
    const native = ai.search(s, { samples: 8 }),
      reference = searchAction(s, { samples: 8 });
    assert.deepEqual(
      native.action,
      reference.action,
      `action ${s.config.count}/${s.steps}`,
    );
    for (const key of [
      "samples",
      "transitions",
      "completed",
      "truncated",
      "epochAdvances",
      "nodes",
      "depth",
      "scenarios",
    ] as const)
      assert.equal(
        native[key],
        reference[key],
        `${key} ${s.config.count}/${s.steps}`,
      );
    assert.equal(native.candidates.length, reference.candidates.length);
    native.candidates.forEach((c, i) => {
      const expected = reference.candidates[i];
      assert.deepEqual(c.action, expected.action);
      assert.equal(c.visits, expected.visits);
      close([c.value, c.error], [expected.value, expected.error]);
    });
  }
});

test("next-epoch search matches TS, crosses one reset and reaches final scoring from epoch two", () => {
  for (const count of [2, 3, 4, 5]) {
    let s = newGame({ count, humans: 0, difficulty: "hard", seed: 87 });
    for (const epoch of [1, 2, 3]) {
      while (s.epoch < epoch || s.phase === "epoch")
        s = simulate(s, policyAction(s));
      const view = observe(s);
      const before = structuredClone(view);
      const native = ai.search(view, { samples: 2, horizon: "next-epoch" });
      const reference = searchAction(view, {
        samples: 2,
        horizon: "next-epoch",
      });
      assert.deepEqual(view, before);
      assert.deepEqual(native.action, reference.action);
      for (const key of [
        "samples",
        "transitions",
        "completed",
        "truncated",
        "epochAdvances",
        "nodes",
        "depth",
        "scenarios",
      ] as const)
        assert.equal(native[key], reference[key], `${epoch}/${key}`);
      native.candidates.forEach((c, i) => {
        const expected = reference.candidates[i];
        assert.deepEqual(c.action, expected.action);
        assert.equal(c.visits, expected.visits);
        close([c.value, c.error], [expected.value, expected.error]);
      });
      assert.ok(native.samples > 0);
      assert.equal(native.truncated, 0);
      assert.equal(native.completed, epoch >= 2 ? native.samples : 0);
      assert.equal(native.epochAdvances, epoch < 3 ? native.samples : 0);
      if (epoch === 1) {
        const short = ai.search(view, { samples: 2, horizon: "epoch" });
        assert.equal(short.epochAdvances, 0);
        assert.ok(native.transitions > short.transitions);
        const hidden = structuredClone(view);
        hidden.bag.reverse();
        hidden.config.seed = 999;
        hidden.players.forEach((p, i) => {
          if (i !== hidden.current) p.score = 999;
        });
        assert.deepEqual(
          ai.search(hidden, { samples: 2, horizon: "next-epoch" }),
          native,
        );
      }
    }
  }
});

test("Wasm search is deterministic, leaves its source intact and ignores private information", () => {
  const s = newGame({ count: 3, humans: 0, difficulty: "hard", seed: 91 }),
    before = structuredClone(s);
  const first = ai.search(s);
  const hidden = structuredClone(s);
  hidden.bag.reverse();
  hidden.config.seed = 998;
  hidden.players.forEach((p, i) => {
    if (i !== s.current) p.score = 999;
  });
  hidden.history = [[{ name: "secret", parts: {}, delta: 999, total: 999 }]];
  assert.deepEqual(ai.search(hidden), first);
  assert.deepEqual(ai.search(s), first);
  assert.deepEqual(s, before);
});

test("SH and DPW variants match TS at 24 public positions and preserve hidden-information isolation", () => {
  assert.equal(positions.length, 24);
  for (const variant of ["sh", "dpw"] as const) {
    for (const s of positions) {
      const before = structuredClone(s),
        options = { samples: 8, variant };
      const native = ai.search(s, options),
        reference = searchAction(observe(s), options);
      assert.deepEqual(
        native.action,
        reference.action,
        `${variant}/${s.config.count}/${s.steps}`,
      );
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
        assert.equal(
          native[key],
          reference[key],
          `${variant}/${s.config.count}/${s.steps}/${key}`,
        );
      native.candidates.forEach((c, i) => {
        const other = reference.candidates[i];
        assert.deepEqual(c.action, other.action);
        assert.equal(c.visits, other.visits);
        assert.ok(c.visits > 0);
        close([c.value, c.error], [other.value, other.error]);
      });
      assert.equal(native.samples, native.candidates.length * 8);
      assert.equal(
        native.candidates.reduce((n, c) => n + c.visits, 0),
        native.samples,
      );
      assert.deepEqual(s, before);
    }
    const s = positions[0],
      hidden = structuredClone(s);
    hidden.bag.reverse();
    hidden.config.seed = 999;
    hidden.players.forEach((p, i) => {
      if (i !== hidden.current) p.score = 999;
    });
    assert.deepEqual(ai.search(s, { variant }), ai.search(hidden, { variant }));
  }
  const s = newGame({ count: 5, humans: 0, difficulty: "hard", seed: 71 });
  const widened = ai.search(s, { variant: "dpw", samples: 64 });
  assert.ok(widened.outcomeReuses > 0);
  assert.ok(
    widened.maxOutcomeBranches <= Math.ceil(2 * Math.sqrt(widened.samples + 1)),
  );
});

test("wall-time search covers every root action and returns legal finite estimates for all variants", () => {
  const s = newGame({ count: 3, humans: 0, difficulty: "hard", seed: 71 });
  for (const variant of ["uct", "sh", "dpw"] as const)
    for (const backend of [ai.search.bind(ai), searchAction]) {
      const t = performance.now();
      const r = backend(observe(s), { variant, timeMs: 5 });
      assert.ok(performance.now() - t < 2000);
      assert.ok(r.samples < 1_000_000);
      assert.ok(
        r.candidates.every((c) => c.visits >= 1 && Number.isFinite(c.value)),
      );
      assert.ok(
        legalActions(s).some(
          (a) => JSON.stringify(a) === JSON.stringify(r.action),
        ),
      );
    }
  for (const timeMs of [0, -1, NaN, Infinity, 1001]) {
    assert.throws(() => ai.search(s, { timeMs }), /思考时间/);
    assert.throws(() => searchAction(s, { timeMs }), /思考时间/);
  }
});

test("DPW particle reuse matches TS across epoch resets without changing the source", () => {
  const s = observe(
    newGame({ count: 3, humans: 0, difficulty: "hard", seed: 87 }),
  );
  const before = structuredClone(s),
    options = {
      samples: 32,
      variant: "dpw" as const,
      horizon: "next-epoch" as const,
    };
  const native = ai.search(s, options),
    reference = searchAction(s, options);
  assert.deepEqual(s, before);
  assert.deepEqual(native.action, reference.action);
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
    assert.equal(native[key], reference[key], key);
  native.candidates.forEach((c, i) => {
    assert.deepEqual(c.action, reference.candidates[i].action);
    assert.equal(c.visits, reference.candidates[i].visits);
    close(
      [c.value, c.error],
      [reference.candidates[i].value, reference.candidates[i].error],
    );
  });
  assert.ok(native.outcomeReuses > 0);
  assert.ok(native.epochAdvances > 0);
  assert.equal(native.truncated, 0);
});

test("native boundary rejects illegal actions and invalid budgets", () => {
  const s = newGame({ count: 2, humans: 0, difficulty: "hard", seed: 17 });
  assert.throws(() => ai.simulate(s, { type: "bid", sun: 999 }), /拒绝/);
  for (const samples of [0, -1, NaN, Infinity, 1.5, 513])
    assert.throws(() => ai.search(s, { samples }), /采样/);
});

test("Wasm AI completes all three epochs in 2–5 player games using the real engine", () => {
  for (const count of [2, 3, 4, 5]) {
    let s = newGame({
      count,
      humans: 0,
      difficulty: "hard",
      seed: 9700 + count,
    });
    while (s.phase !== "over" && s.steps < 1500)
      s = advance(s, ai.search(s).action);
    assert.equal(s.phase, "over");
    assert.equal(s.history.length, 3);
  }
});
